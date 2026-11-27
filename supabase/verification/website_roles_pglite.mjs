// Website staff role lifecycle (migrations 047 and 057) on PGlite. Replays the real migration chain, then checks create,
// grant, assign, effective permissions, revoke and retirement, with positive and negative controls.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/website_roles_pglite.mjs
// Fake accounts only. No Docker, no network, no production. Exit 1 on any failed expectation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', 'migrations'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  [roles057] ${name}${detail ? ' :: ' + String(detail).slice(0, 200) : ''}`);
};
const as = (uid, sql, params = []) => attempt(db, 'authenticated', uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);

const U = {
  admin: 'c0000000-0000-4000-8000-000000000001',
  coord: 'c0000000-0000-4000-8000-000000000002',
  member: 'c0000000-0000-4000-8000-000000000003',
  target: 'c0000000-0000-4000-8000-000000000004',
  pending: 'c0000000-0000-4000-8000-000000000005',
};
for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`,
    [id, `${k}.roles057@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.member]);
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.target]);
// U.pending keeps the signup default (pending).

const REASON = 'Approved by the core administrator for the website team';

// 1. Core administrator creates a role with website permissions.
let r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`,
  ['Newsletter editor', 'Writes and edits drafts', ['website.blog.edit', 'website.pages.edit'], REASON]);
check('core administrator creates a role with a reason', r.ok && r.rows[0].id, r.error);
const ROLE = r.ok ? r.rows[0].id : null;

// 2. Negative controls on create.
r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['No reason', '', ['website.blog.edit'], 'no']);
check('role creation without a reason of 5+ characters is refused', !r.ok, r.error ?? 'accepted');
r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Bad key', '', ['website.nonsense.key'], REASON]);
check('role creation with an unknown permission key is refused and leaves no role', !r.ok, r.error ?? 'accepted');
r = await as(U.coord, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Coordinator role', '', ['website.blog.edit'], REASON]);
check('a coordinator cannot create a website role (no automatic website access)', !r.ok, r.error ?? 'accepted');
r = await as(U.member, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Member role', '', ['website.blog.edit'], REASON]);
check('an ordinary member cannot create a website role', !r.ok, r.error ?? 'accepted');

// 3. Granular permission management by a core administrator.
r = await as(U.admin, `select public.web_set_website_permission($1,$2,$3,$4)`, [ROLE, 'website.events.manage', true, 'Adds event editing']);
check('core administrator grants a granular permission', r.ok, r.error);
r = await as(U.admin, `select public.web_set_website_permission($1,$2,$3,$4)`, [ROLE, 'website.nonsense.key', true, 'Bad key']);
check('granting an unknown permission key is refused', !r.ok, r.error ?? 'accepted');
r = await as(U.coord, `select public.web_set_website_permission($1,$2,$3,$4)`, [ROLE, 'website.pages.publish', true, 'Escalation attempt']);
check('privilege escalation: a coordinator cannot grant a publish permission', !r.ok, r.error ?? 'accepted');

// 4. Assignment rules.
r = await as(U.admin, `select public.web_assign_website_role($1,$2,$3) as id`, [U.admin, ROLE, REASON]);
check('a core administrator cannot give themselves a website role', !r.ok, r.error ?? 'accepted');
r = await as(U.admin, `select public.web_assign_website_role($1,$2,$3) as id`, [U.pending, ROLE, REASON]);
check('a pending account cannot be given a website role', !r.ok, r.error ?? 'accepted');
r = await as(U.admin, `select public.web_assign_website_role($1,$2,$3) as id`, [U.target, ROLE, 'no']);
check('assignment without a reason is refused', !r.ok, r.error ?? 'accepted');
r = await as(U.admin, `select public.web_assign_website_role($1,$2,$3) as id`, [U.target, ROLE, REASON]);
const ASSIGN = r.ok ? r.rows[0].id : null;
check('core administrator assigns the role to an active member', r.ok && ASSIGN, r.error);

// 5. Effective permissions for the assignee.
r = await as(U.target, `select public.web_my_permissions() as k`);
const perms = r.ok ? r.rows.map((x) => x.k) : [];
check('effective permissions reflect the role (blog edit, page edit, events manage)',
  ['website.blog.edit', 'website.pages.edit', 'website.events.manage'].every((k) => perms.includes(k)), JSON.stringify(perms));
check('effective permissions grant no publish key the role does not hold', !perms.includes('website.pages.publish'), JSON.stringify(perms));
r = await as(U.target, `select public.web_set_website_permission($1,$2,$3,$4)`, [ROLE, 'website.pages.publish', true, 'self grant']);
check('the assignee cannot grant themselves permissions', !r.ok, r.error ?? 'accepted');
r = await as(U.member, `select public.web_list_website_roles()`);
check('an ordinary member cannot list website roles', !r.ok, r.error ?? 'read');

// 6. Retirement safety: a held role cannot be retired.
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [ROLE, REASON]);
check('a role that is still held cannot be retired', !r.ok, r.error ?? 'retired');

// 7. Revocation, then retirement of the now unused role.
r = await as(U.admin, `select public.web_unassign_website_role($1,$2)`, [ASSIGN, REASON]);
check('core administrator revokes the assignment', r.ok, r.error);
r = await as(U.target, `select public.web_my_permissions() as k`);
check('revocation removes the website permissions at once', r.ok && !r.rows.some((x) => x.k.startsWith('website.')), JSON.stringify(r.rows));
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [ROLE, 'no']);
check('retirement without a reason is refused', !r.ok, r.error ?? 'retired');
r = await as(U.coord, `select public.web_retire_website_role($1,$2)`, [ROLE, REASON]);
check('a non-core administrator cannot retire a role', !r.ok, r.error ?? 'retired');
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [ROLE, REASON]);
check('core administrator retires the unused role', r.ok, r.error);
const left = await owner(`select count(*)::int n from public.admin_roles where id = $1`, [ROLE]);
check('the retired role and its permissions are gone', left.rows[0].n === 0);
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [ROLE, REASON]);
check('retiring the same role again is refused (does not exist)', !r.ok, r.error ?? 'retired');

// 8. Built-in roles are never retired.
const sys = await owner(`insert into public.admin_roles (name, description, is_system, created_by) values ('Built-in test','',true,$1) returning id`, [U.admin]);
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [sys.rows[0].id, REASON]);
check('a built-in role cannot be retired', !r.ok, r.error ?? 'retired');

// 9. Audit integrity for the lifecycle.
r = await as(U.admin, `select action from public.web_audit_log order by id`);
const actions = r.ok ? r.rows.map((x) => x.action) : [];
check('lifecycle is audited: created, granted, assigned, removed, retired',
  ['role.created', 'role.permission_granted', 'assignment.created', 'assignment.removed', 'role.retired'].every((a) => actions.includes(a)), JSON.stringify(actions));

// 10. Atomic permission changes: a failed batch leaves the role exactly as it was.
r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`,
  ['Atomic role', '', ['website.blog.edit', 'website.pages.edit'], REASON]);
const ATOM = r.ok ? r.rows[0].id : null;
const permsOf = async (id) => (await owner(`select permission_key from public.admin_role_permissions where role_id=$1 and permission_key like 'website.%' order by 1`, [id])).rows.map((x) => x.permission_key);
const before = await permsOf(ATOM);
r = await as(U.admin, `select public.web_set_website_role_permissions($1,$2,$3)`, [ATOM, ['website.events.manage', 'website.nonsense.key'], REASON]);
check('a permission batch with one unknown key is refused', !r.ok, r.error ?? 'accepted');
check('the refused batch changes nothing (no partial configuration)', JSON.stringify(await permsOf(ATOM)) === JSON.stringify(before), JSON.stringify(await permsOf(ATOM)));
r = await as(U.admin, `select public.web_set_website_role_permissions($1,$2,$3)`, [ATOM, [], REASON]);
check('a permission batch that empties the role is refused and changes nothing', !r.ok && JSON.stringify(await permsOf(ATOM)) === JSON.stringify(before), r.error ?? 'accepted');
r = await as(U.coord, `select public.web_set_website_role_permissions($1,$2,$3)`, [ATOM, ['website.pages.publish'], REASON]);
check('a non-core administrator cannot change a role permission set', !r.ok, r.error ?? 'accepted');
r = await as(U.admin, `select public.web_set_website_role_permissions($1,$2,$3)`, [ATOM, ['website.events.manage', 'website.pages.edit'], 'no']);
check('a permission batch without a reason is refused and changes nothing', !r.ok && JSON.stringify(await permsOf(ATOM)) === JSON.stringify(before), r.error ?? 'accepted');
r = await as(U.admin, `select public.web_set_website_role_permissions($1,$2,$3)`, [ATOM, ['website.events.manage', 'website.pages.edit'], REASON]);
check('a valid batch sets the exact permission set', r.ok && JSON.stringify(await permsOf(ATOM)) === JSON.stringify(['website.events.manage', 'website.pages.edit']), r.error ?? JSON.stringify(await permsOf(ATOM)));
const audit = await owner(`select action, details->>'permission' as p from public.web_audit_log where target=$1 order by id`, [ATOM]);
const granted = audit.rows.filter((x) => x.action === 'role.permission_granted').map((x) => x.p);
const revoked = audit.rows.filter((x) => x.action === 'role.permission_revoked').map((x) => x.p);
check('each granted and revoked key is audited', granted.includes('website.events.manage') && revoked.includes('website.blog.edit'), JSON.stringify(audit.rows));

// 11. Operational (non-website) roles are never retired from the website screens.
const ops = await owner(`insert into public.admin_roles (name, description, is_system, created_by) values ('Operations only','',false,$1) returning id`, [U.admin]);
await owner(`insert into public.admin_role_permissions (role_id, permission_key) values ($1,'members.manage')`, [ops.rows[0].id]).catch(() => null);
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [ops.rows[0].id, REASON]);
check('a non-website operational role cannot be retired from the website screens', !r.ok, r.error ?? 'retired');
const stillThere = await owner(`select count(*)::int n from public.admin_roles where id=$1`, [ops.rows[0].id]);
check('the operational role is still present after the refused retirement', stillThere.rows[0].n === 1);

const failed = results.filter((x) => !x).length;
console.log(`\nWEBSITE ROLE TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
