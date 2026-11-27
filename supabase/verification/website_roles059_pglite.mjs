// Migration 059: website roles must keep at least one website permission (PGlite regression suite).
// Replays the real migration chain 000-059, then checks positive and negative cases, including direct table writes that
// bypass the RPCs. Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/website_roles059_pglite.mjs
// Fake accounts only. No Docker, no network, no production. Exit 1 on any failed expectation.
import io from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', 'migrations'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  [roles059] ${name}${detail ? ' :: ' + String(detail).slice(0, 200) : ''}`);
};
const as = (uid, sql, params = []) => attempt(db, 'authenticated', uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);

const U = {
  admin: 'd0000000-0000-4000-8000-000000000001',
  coord: 'd0000000-0000-4000-8000-000000000002',
  target: 'd0000000-0000-4000-8000-000000000003',
};
for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`,
    [id, `${k}.roles059@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
await owner(`update public.profiles set role='member', status='active' where id=$1`, [U.target]);
const REASON = 'Approved by the core administrator for the website team';
const countRoles = async (name) => (await owner(`select count(*)::int as n from public.admin_roles where name=$1`, [name])).rows[0].n;
const countAudit = async (action) => (await owner(`select count(*)::int as n from public.web_audit_log where action=$1`, [action])).rows[0].n;
const websiteKeys = async (roleId) =>
  (await owner(`select permission_key from public.admin_role_permissions where role_id=$1 and permission_key like 'website.%' order by 1`, [roleId])).rows.map((r) => r.permission_key);

// ---- Positive: a valid role is created with its permissions in one call --------------------------------------------
let r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`,
  ['Pages and blog', '', ['website.blog.edit', 'website.pages.edit'], REASON]);
check('positive: a role with two website permissions is created', r.ok && r.rows[0].id, r.error);
const ROLE = r.ok ? r.rows[0].id : null;

// ---- Negative: creation refusals leave no role row behind -------------------------------------------------------------
r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Null set', '', null, REASON]);
check('negative: null permission set is refused', !r.ok, r.error ?? 'accepted');
check('negative: null set leaves no role row', (await countRoles('Null set')) === 0);
r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Empty set', '', [], REASON]);
check('negative: empty permission set is refused', !r.ok, r.error ?? 'accepted');
check('negative: empty set leaves no role row', (await countRoles('Empty set')) === 0);
r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Null key', '', ['website.blog.edit', null], REASON]);
check('negative: a null key inside a set is refused', !r.ok, r.error ?? 'accepted');
check('negative: a null key leaves no role row', (await countRoles('Null key')) === 0);
r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Bad key', '', ['website.blog.edit', 'website.nope'], REASON]);
check('negative: an unknown key refuses the whole role', !r.ok, r.error ?? 'accepted');
check('negative: an unknown key leaves no role row', (await countRoles('Bad key')) === 0);
r = await as(U.coord, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Coord role', '', ['website.blog.edit'], REASON]);
check('negative: a coordinator cannot create a website role', !r.ok, r.error ?? 'accepted');

// ---- Revocation through the RPC cannot remove the last website permission -----------------------------------------------
r = await as(U.admin, `select public.web_set_website_permission($1,$2,$3,$4)`, [ROLE, 'website.blog.edit', false, 'Removing one of two']);
check('positive: revoking one of two website permissions is allowed', r.ok, r.error);
check('positive: the role keeps the remaining permission', JSON.stringify(await websiteKeys(ROLE)) === JSON.stringify(['website.pages.edit']));
r = await as(U.admin, `select public.web_set_website_permission($1,$2,$3,$4)`, [ROLE, 'website.pages.edit', false, 'Removing the last one']);
check('negative: revoking the last website permission through the RPC is refused', !r.ok, r.error ?? 'accepted');
check('negative: the refused revoke leaves the permission in place', JSON.stringify(await websiteKeys(ROLE)) === JSON.stringify(['website.pages.edit']));

// ---- Revocation by direct table writes cannot bypass the rule -----------------------------------------------------------
// Run as the database owner so the trigger, not row-level security, is what decides. (Authenticated writes are also
// blocked by RLS: see the note at the end.)
r = await owner(`delete from public.admin_role_permissions where role_id=$1 and permission_key='website.pages.edit'`, [ROLE]).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('negative: a direct DELETE of the last website key is refused by the trigger', !r.ok && /at least one website permission/.test(r.error ?? ''), r.error ?? 'accepted');
check('negative: the direct DELETE left the key in place', JSON.stringify(await websiteKeys(ROLE)) === JSON.stringify(['website.pages.edit']));
r = await owner(`update public.admin_role_permissions set permission_key='website.blog.edit' where role_id=$1 and permission_key='website.pages.edit'`, [ROLE]).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('negative: a direct UPDATE that moves the last website key away is refused by the trigger', !r.ok && /at least one website permission/.test(r.error ?? ''), r.error ?? 'accepted');
check('negative: the direct UPDATE left the key in place', JSON.stringify(await websiteKeys(ROLE)) === JSON.stringify(['website.pages.edit']));

// ---- Operational permissions on the same role are not affected ----------------------------------------------------------
await owner(`insert into public.admin_role_permissions (role_id, permission_key) values ($1, 'contacts.write')`, [ROLE]);
r = await as(U.admin, `select public.web_set_website_permission($1,$2,$3,$4)`, [ROLE, 'website.events.manage', true, 'Adds event editing']);
check('setup: the core administrator adds a second website key through the RPC', r.ok, r.error);
r = await as(U.admin, `insert into public.admin_role_permissions (role_id, permission_key) values ($1, 'website.blog.edit')`, [ROLE]);
check('negative: a direct INSERT of a website key by a core administrator is refused by RLS', !r.ok, r.error ?? 'accepted');
r = await owner(`delete from public.admin_role_permissions where role_id=$1 and permission_key='contacts.write'`, [ROLE]).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('positive: an operational permission can be removed while website permissions remain', r.ok, r.error);
r = await as(U.admin, `select public.web_set_website_permission($1,$2,$3,$4)`, [ROLE, 'website.events.manage', false, 'Removing event editing']);
check('positive: a website key can be removed through the RPC while another website key remains', r.ok, r.error);

// ---- Retirement still works, for this role only --------------------------------------------------------------------------
r = await as(U.admin, `select public.web_create_website_role($1,$2,$3,$4) as id`, ['Other role', '', ['website.pages.edit'], REASON]);
const OTHER = r.rows[0].id;
r = await as(U.admin, `select public.web_assign_website_role($1,$2,$3) as id`, [U.target, OTHER, REASON]);
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [ROLE, REASON]);
check('positive: a website role with permissions can be retired through the RPC', r.ok, r.error);
check('positive: the retired role is gone and its retirement is audited', (await countRoles('Pages and blog')) === 0 && (await countAudit('role.retired')) >= 1);
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [OTHER, REASON]);
check('negative: a different assigned role cannot be retired (assignments still block)', !r.ok, r.error ?? 'accepted');
r = await owner(`delete from public.admin_role_permissions where role_id=$1 and permission_key='website.pages.edit'`, [OTHER]).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('negative: the retirement exemption does not leak to another role', !r.ok && /at least one website permission/.test(r.error ?? ''), r.error ?? 'accepted');
check('negative: the other role keeps its permission', JSON.stringify(await websiteKeys(OTHER)) === JSON.stringify(['website.pages.edit']));

// ---- Operational roles are untouched: an operational role with no website keys can change freely ----------------------
const OPS = (await owner(`insert into public.admin_roles (name, description, created_by) values ('Ops probe', '', $1) returning id`, [U.admin])).rows[0].id;
await owner(`insert into public.admin_role_permissions (role_id, permission_key) values ($1, 'contacts.view_all')`, [OPS]);
r = await owner(`delete from public.admin_role_permissions where role_id=$1 and permission_key='contacts.view_all'`, [OPS]).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('positive: the last operational permission of a non-website role can still be removed', r.ok, r.error);

// ---- Audit: refusals write nothing; the audit trail of granted and revoked keys is intact --------------------------------
check('audit: no role.created row exists for any refused creation', (await owner(`select count(*)::int as n from public.web_audit_log where action='role.created' and details->>'name' in ('Null set','Empty set','Null key','Bad key')`)).rows[0].n === 0);
check('audit: the successful revocation is recorded', (await countAudit('role.permission_revoked')) >= 1);

// ---- Existing empty roles: the read-only report finds them, changes nothing, and recovery works -------------------------
const LEGACY = (await owner(`insert into public.admin_roles (name, description, created_by) values ('Legacy empty', '', $1) returning id`, [U.admin])).rows[0].id;
const reportSql = io.readFileSync(path.join(here, 'website_empty_roles_report.sql'), 'utf8');
const beforeAll = (await owner(`select count(*)::int as n from public.admin_roles`)).rows[0].n;
const report = await owner(reportSql.replace(/--[^\n]*/g, ''));
const rows = report.rows.filter((x) => x.name === 'Legacy empty');
check('report: the legacy empty role is listed', rows.length === 1, JSON.stringify(report.rows).slice(0, 120));
check('report: it changes nothing', (await owner(`select count(*)::int as n from public.admin_roles`)).rows[0].n === beforeAll);
r = await as(U.admin, `select public.web_set_website_role_permissions($1,$2,$3)`, [LEGACY, ['website.pages.edit'], 'Recovery: set intended permissions']);
check('recovery: the core administrator gives the legacy role its website permissions', r.ok, r.error);
r = await as(U.admin, `select public.web_retire_website_role($1,$2)`, [LEGACY, 'Recovery: unused role retired']);
check('recovery: the recovered role can then be retired through the audited RPC', r.ok, r.error);

const failed = results.filter((x) => !x).length;
console.log(`\nWEBSITE ROLE 059 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
