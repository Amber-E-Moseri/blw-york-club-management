// Website Management (Phase D2) database tests. Replays every migration in supabase/migrations (000-116) on a disposable
// in-process PGlite database, then exercises the website permission model, publishing, versions, blog, events, inquiries,
// rate limits, media and privacy. Roles are switched with attempt(), which uses the shim's auth.uid() and role settings.
// No Docker, no network, no production. Fake accounts only. Exit 1 on any failed expectation.
//
// Run:  PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/website_d2_pglite_test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', 'migrations'));

const out = [];
const check = (area, name, ok, detail = '') => {
  out.push({ area, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? ' :: ' + String(detail).slice(0, 220) : ''}`);
};
// Uploads happen in storage before registration. In the replay, the object is staged automatically for each
// registration, with the declared name, size and type, unless autoStage is switched off for a negative test.
let autoStage = true;
const as = async (role, uid, sql, params = []) => {
  const m = /web_register_media\('([^']+)','([^']+)','([^']+)',(\d+),/.exec(sql);
  if (m && autoStage) {
    await db.query("insert into storage.objects (bucket_id, name, metadata) select $1, $2, $3::jsonb where not exists (select 1 from storage.objects where bucket_id = $1 and name = $2)",
      [m[1], m[2], JSON.stringify({ size: m[4], mimetype: m[3] })]);
  }
  return attempt(db, role, uid, sql, params);
};
const owner = (sql, params = []) => db.query(sql, params);
const refused = (r) => !r.ok;
const HASH = createHash('sha256').update('consent text v1').digest('hex');

// ---------- accounts
const U = {
  admin: 'b0000000-0000-4000-8000-000000000001',
  coord: 'b0000000-0000-4000-8000-000000000002',
  editor: 'b0000000-0000-4000-8000-000000000003',
  publisher: 'b0000000-0000-4000-8000-000000000004',
  contributor: 'b0000000-0000-4000-8000-000000000005',
  analyst: 'b0000000-0000-4000-8000-000000000006',
  reviewer: 'b0000000-0000-4000-8000-000000000007',
  pending: 'b0000000-0000-4000-8000-000000000008',
  member: 'b0000000-0000-4000-8000-000000000009',
  other: 'b0000000-0000-4000-8000-00000000000a',
};
const EV_ALL = 'b1000000-0000-4000-8000-000000000001';
const EV_MEET = 'b1000000-0000-4000-8000-000000000002';
const MEETING = 'b1000000-0000-4000-8000-000000000003';
const ROLE = {
  admin: '7a000000-0000-4000-8000-000000000001', editor: '7a000000-0000-4000-8000-000000000002',
  publisher: '7a000000-0000-4000-8000-000000000003', contributor: '7a000000-0000-4000-8000-000000000004',
  analyst: '7a000000-0000-4000-8000-000000000005',
};

for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`,
    [id, `${k}.d2@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
for (const k of ['editor', 'publisher', 'contributor', 'analyst', 'reviewer', 'member', 'other']) {
  await owner(`update public.profiles set role='member', status='active' where id=$1`, [U[k]]);
}
// pending stays pending (signup default)

// Events fixtures (the 037 table plus the 038/060 audience columns). One open event, one meeting-targeted event.
await owner(`insert into public.meetings (id,title,date,time,created_by) values ($1,'Test meeting','2026-11-01','18:00',$2)`, [MEETING, U.admin]);
await owner(`insert into public.events (id,title,date,location,created_by) values ($1,'Bible Study','2026-11-12','York University',$2)`, [EV_ALL, U.admin]);
await owner(`insert into public.events (id,title,date,location,created_by,audience,audience_meeting_id) values ($1,'Private cell night','2026-11-13','Hall',$2,'meeting',$3)`, [EV_MEET, U.admin, MEETING]);

// People and contacts already exist as CRM data. They must stay invisible to website staff.
const crmBefore = (await owner(`select (select count(*)::int from public.people) p, (select count(*)::int from public.contacts) c`)).rows[0];

// Hub RBAC fixtures. Website roles are the Hub's admin_roles, with the approved built-in grants written as data. Rows are
// seeded as the core administrator: the owner's session impersonates that account, so the website guard in migration
// 107 sees a real core administrator. The owner bypasses RLS here, as other fixtures in this suite do.
const WEB_BUILTIN = {
  [ROLE.admin]: ['Website Administrator', ['website.pages.edit', 'website.pages.publish', 'website.blog.edit', 'website.blog.publish', 'website.events.manage', 'website.events.publish', 'website.rhapsody.manage', 'website.rhapsody.publish', 'website.media.upload', 'website.media.manage', 'website.navigation.edit', 'website.settings.edit', 'website.settings.publish', 'website.analytics.view', 'website.submissions.review']],
  [ROLE.editor]: ['Website Editor', ['website.pages.edit', 'website.blog.edit', 'website.events.manage', 'website.rhapsody.manage', 'website.media.upload', 'website.media.manage', 'website.navigation.edit']],
  [ROLE.publisher]: ['Website Publisher', ['website.pages.edit', 'website.pages.publish', 'website.blog.edit', 'website.blog.publish', 'website.events.manage', 'website.events.publish', 'website.rhapsody.manage', 'website.rhapsody.publish', 'website.media.upload', 'website.settings.publish']],
  [ROLE.contributor]: ['Website Contributor', ['website.blog.edit', 'website.media.upload']],
  [ROLE.analyst]: ['Website Analyst', ['website.analytics.view']],
};
await owner(`select set_config('request.jwt.claim.sub', $1, false)`, [U.admin]);
for (const [id, [name, perms]] of Object.entries(WEB_BUILTIN)) {
  await owner(`insert into public.admin_roles (id,name,description,created_by) values ($1,$2,'Built-in website role',$3)`, [id, name, U.admin]);
  for (const p of perms) await owner(`insert into public.admin_role_permissions (role_id,permission_key) values ($1,$2)`, [id, p]);
}
const seeded = {};
for (const [who, role] of [['editor', ROLE.editor], ['publisher', ROLE.publisher], ['contributor', ROLE.contributor], ['analyst', ROLE.analyst]]) {
  const a = await owner(`insert into public.admin_role_assignments (role_id,user_id,assigned_by) values ($1,$2,$3) returning id`, [role, U[who], U.admin]);
  seeded[who] = a.rows[0].id;
}
await owner(`select set_config('request.jwt.claim.sub', '', false)`);

// =====================================================================================================================
// 1. Core administrator authority, website roles on the Hub RBAC, and coordinator limits
// =====================================================================================================================
let r = await as('authenticated', U.admin, `select web_is_core_admin() v`);
check('roles', 'core administrator (Hub role admin) is recognised', r.ok && r.rows[0].v === true);
r = await as('authenticated', U.coord, `select web_is_core_admin() v`);
check('roles', 'coordinator is NOT a core website administrator', r.ok && r.rows[0].v === false);
r = await as('authenticated', U.coord, `select * from public.web_my_permissions()`);
check('roles', 'coordinator holds no website permissions by default', r.ok && r.rows.length === 0, JSON.stringify(r.rows));
r = await as('authenticated', U.coord, `select has_admin_permission('website.pages.publish') v`);
check('roles', 'the Hub helper would grant a coordinator any key (why the website helper does not use it)', r.ok && r.rows[0].v === true, JSON.stringify(r.rows));

r = await as('authenticated', U.coord, `select web_create_website_role('Coordinator role','',array[]::text[],'Coordinator tries to create a role')`);
check('roles', 'coordinator cannot create a website role', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_create_website_role('Editor role','',array[]::text[],'Editor tries to create a role')`);
check('roles', 'website editor cannot create a website role', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_set_website_permission($1,'website.everything',true,'Unknown key should fail')`, [ROLE.contributor]);
check('roles', 'unknown website permission key is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');

r = await as('authenticated', U.admin, `select web_create_website_role('Newsletter reviewer','Reviews inquiries only',array['website.submissions.review']::text[],'Reviewer role for the term')`);
check('roles', 'core administrator creates a custom website role with a reason', r.ok && !!r.rows[0].web_create_website_role, r.error || '');
const customRole = r.rows?.[0]?.web_create_website_role;
r = await as('authenticated', U.admin, `select web_set_website_permission($1,'website.submissions.review',true,'Reviewers read inquiries')`, [customRole]);
check('roles', 'core administrator grants a website permission to a role', r.ok, r.error || '');
r = await as('authenticated', U.admin, `select web_assign_website_role($1,$2,'x')`, [U.reviewer, customRole]);
check('roles', 'assignment with a reason under 5 characters is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_assign_website_role($1,$2,'Assigned to review inquiries')`, [U.reviewer, customRole]);
check('roles', 'core administrator assigns the custom role', r.ok, r.error || '');
const reviewerAssignment = r.rows?.[0]?.web_assign_website_role;
r = await as('authenticated', U.admin, `select web_assign_website_role($1,$2,'Self assignment should fail')`, [U.admin, ROLE.analyst]);
check('roles', 'self-assignment of a website role is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_assign_website_role($1,$2,'Pending person should not get a role')`, [U.pending, ROLE.editor]);
check('roles', 'assignment to a pending account is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_assign_website_role($1,$2,'Editing the homepage text this term')`, [U.editor, ROLE.editor]);
check('roles', 'core administrator re-assigns the Website Editor role (idempotent on the seeded row)', r.ok, r.error || '');
const editorAssignment = r.rows?.[0]?.web_assign_website_role ?? seeded.editor;

r = await as('authenticated', U.editor, `select * from public.web_my_permissions()`);
const editorPerms = r.ok ? r.rows.map((x) => x.permission_key) : [];
check('roles', 'editor holds content edit permissions', editorPerms.includes('website.pages.edit') && editorPerms.includes('website.blog.edit'), JSON.stringify(editorPerms));
check('roles', 'editor holds no publish permission', !editorPerms.some((k) => k.endsWith('.publish')), JSON.stringify(editorPerms));

// Direct table writes are refused for website staff. The Hub RLS and the website guard both apply.
r = await as('authenticated', U.editor, `insert into public.admin_role_assignments (role_id,user_id,assigned_by) values ($1,$2,$3)`, [ROLE.admin, U.editor, U.editor]);
check('roles', 'editor cannot insert a role assignment directly', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `insert into public.admin_role_permissions (role_id,permission_key) values ($1,'website.pages.publish')`, [ROLE.editor]);
check('roles', 'editor cannot add a website permission to a role directly', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `update public.admin_roles set name = 'Owner' where id = $1`, [ROLE.editor]);
check('roles', 'editor cannot rename a role directly', refused(r) || r.rows?.length === 0, r.error || 'updated 0 rows is also refused');
r = await as('authenticated', U.editor, `update public.profiles set role = 'admin' where id = $1`, [U.editor]);
check('roles', 'editor cannot promote their own Hub role', refused(r) || r.rows?.length === 0, r.error || 'updated 0 rows is also refused');
const editorAdmins = await as('authenticated', U.editor, `select count(*)::int n from public.profiles where role = 'admin'`);
const memberAdmins = await as('authenticated', U.member, `select count(*)::int n from public.profiles where role = 'admin'`);
check('roles', 'website role adds no Hub profile visibility (same as an ordinary member)', editorAdmins.ok && memberAdmins.ok && editorAdmins.rows[0].n === memberAdmins.rows[0].n, `${editorAdmins.rows?.[0]?.n} vs ${memberAdmins.rows?.[0]?.n}`);

// Remaining built-in assignments, so the later sections exercise their real permissions.
for (const [who, role, why] of [['publisher', ROLE.publisher, 'Publishing the spring content'], ['contributor', ROLE.contributor, 'Writing blog drafts this term'], ['analyst', ROLE.analyst, 'Reporting on downloads']]) {
  const a = await as('authenticated', U.admin, `select web_assign_website_role($1,$2,$3)`, [U[who], role, why]);
  check('roles', `core administrator assigns the ${who} role`, a.ok, a.error || '');
}

// Decision A: a coordinator can receive website rights, but only explicitly, and never publishing without a publish key.
r = await as('authenticated', U.admin, `select web_assign_website_role($1,$2,'Coordinator needs read-only analytics')`, [U.coord, ROLE.analyst]);
check('coordinator', 'core administrator can give a coordinator an explicit website role', r.ok, r.error || '');
const coordAssignment = r.rows?.[0]?.web_assign_website_role;
r = await as('authenticated', U.coord, `select * from public.web_my_permissions()`);
check('coordinator', 'coordinator holds exactly the assigned permission', r.ok && JSON.stringify(r.rows.map((x) => x.permission_key)) === '["website.analytics.view"]', JSON.stringify(r.rows));
r = await as('authenticated', U.coord, `insert into public.admin_role_assignments (role_id,user_id,assigned_by) values ($1,$2,$3)`, [ROLE.publisher, U.coord, U.coord]);
check('coordinator', 'coordinator cannot give themselves a website role (Hub RLS allows it, the website guard refuses)', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.coord, `insert into public.admin_role_permissions (role_id,permission_key) values ($1,'website.pages.publish')`, [ROLE.analyst]);
check('coordinator', 'coordinator cannot add a website publish key to a role', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.coord, `select web_assign_website_role($1,$2,'Coordinator tries to assign a role')`, [U.member, ROLE.editor]);
check('coordinator', 'coordinator cannot assign website roles through the function', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.coord, `select web_set_website_permission($1,'website.pages.publish',true,'Coordinator tries to grant publish')`, [ROLE.analyst]);
check('coordinator', 'coordinator cannot grant a website permission through the function', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.coord, `select * from public.web_list_website_roles()`);
check('coordinator', 'coordinator cannot list website roles', refused(r), r.error || 'UNEXPECTED SUCCESS');

// Hub rule that must still hold: a coordinator can still manage Hub-only keys (unchanged by this migration).
r = await as('authenticated', U.coord, `insert into public.admin_role_permissions (role_id,permission_key) values ($1,'contacts.view_all')`, [ROLE.analyst]);
check('hub', 'coordinators can still grant Hub keys (behaviour unchanged)', r.ok, r.error || '');
await owner(`delete from public.admin_role_permissions where role_id = $1 and permission_key = 'contacts.view_all'`, [ROLE.analyst]);
r = await as('authenticated', U.admin, `select count(*)::int n from public.web_list_website_roles()`);
check('roles', 'core administrator can list website roles', r.ok && r.rows[0].n >= 5, r.error || JSON.stringify(r.rows));
r = await as('authenticated', U.admin, `select web_unassign_website_role($1,'Coordinator read access ends after the review')`, [coordAssignment]);
check('coordinator', 'core administrator removes the coordinator assignment with a reason', r.ok, r.error || '');

// =====================================================================================================================
// 2. Content: draft, publish, versions, rollback, public visibility
// =====================================================================================================================
const pageBody = (title, text, visible = true) => JSON.stringify({ title, seo_title: title, seo_description: 'Desc', visible,
  sections: [{ type: 'hero', heading: 'Welcome', body: text, visible: true }] });

r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,1)`, [pageBody('Home', 'Draft one')]);
check('content', 'editor saves a page draft', r.ok && r.rows[0].web_save_draft === 2, r.error || '');
r = await as('authenticated', U.editor, `select web_publish_content('page','home',2,'editor attempts publish')`);
check('content', 'editor cannot publish a page', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,1)`, [pageBody('Home', 'stale')]);
check('content', 'stale expected version is refused (optimistic concurrency)', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.publisher, `select web_publish_content('page','home',2,'First publication')`);
check('content', 'publisher publishes the draft', r.ok && !!r.rows[0].web_publish_content, r.error || '');
const v1 = r.rows?.[0]?.web_publish_content;
let anon = await as('anon', null, `select kind,key,body->>'title' t from public.v_public_content where kind='page' and key='home'`);
check('content', 'anonymous visitors see the published page', anon.ok && anon.rows[0]?.t === 'Home', anon.error || JSON.stringify(anon.rows));
r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,2)`, [pageBody('Home', 'Draft two, not yet published')]);
anon = await as('anon', null, `select body->'sections'->0->>'body' b from public.v_public_content where kind='page' and key='home'`);
check('content', 'unpublished draft changes are NOT visible to anonymous visitors', anon.ok && anon.rows[0]?.b === 'Draft one', JSON.stringify(anon.rows));
r = await as('authenticated', U.publisher, `select web_publish_content('page','home',3,'Second publication')`);
const v2 = r.rows?.[0]?.web_publish_content;
anon = await as('anon', null, `select body->'sections'->0->>'body' b from public.v_public_content where kind='page' and key='home'`);
check('content', 'publishing updates the public page body', anon.ok && anon.rows[0]?.b === 'Draft two, not yet published', JSON.stringify(anon.rows));
r = await as('authenticated', U.publisher, `select web_rollback_content('page','home',$1,'Reverting to the first text')`, [v1]);
anon = await as('anon', null, `select body->'sections'->0->>'body' b from public.v_public_content where kind='page' and key='home'`);
check('content', 'rollback to an earlier version restores the public body', r.ok && anon.rows[0]?.b === 'Draft one', r.error || JSON.stringify(anon.rows));
r = await as('authenticated', U.publisher, `select web_rollback_content('page','home',$1,'Wrong content')`, [v2]);
r = await as('authenticated', U.publisher, `select web_rollback_content('page','contact',$1,'Cross-page rollback attempt')`, [v1]);
check('content', 'rollback to another page version is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.publisher, `select web_rollback_content('page','home',$1,'no')`, [v1]);
check('content', 'rollback needs a reason of 5 characters or more', refused(r), r.error || 'UNEXPECTED SUCCESS');

r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,3)`, [JSON.stringify({ title: 'X', sections: [{ type: 'script', heading: 'x', body: '<script>', visible: true }] })]);
check('content', 'unknown section type (script) is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,3)`, [JSON.stringify({ title: 'X', extra: 'nope' })]);
check('content', 'unknown page field is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,3)`, [JSON.stringify({ title: 'X', sections: [{ type: 'cta', heading: 'Go', body: 'x', visible: true, url: 'javascript:alert(1)' }] })]);
check('content', 'javascript: link is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,3)`, [JSON.stringify({ title: 'X', sections: [{ type: 'cta', heading: 'Go', body: 'x', visible: true, url: 'https://user:pw@example.org/' }] })]);
check('content', 'link with embedded credentials is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,3)`, [JSON.stringify({ title: 'X', seo_title: 'x'.repeat(61) })]);
check('content', 'SEO title over 60 characters is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_save_draft('page','home',$1::jsonb,3)`, [JSON.stringify({ title: 'Recovered', visible: true })]);
check('content', 'a valid, simple page draft is accepted', r.ok, r.error || '');

r = await as('authenticated', U.admin, `select web_save_draft('settings','site',$1::jsonb,1)`, [JSON.stringify({ site_name: 'BLW York Hub', primary_color: 'red' })]);
check('settings', 'colour that is not a hex value is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_save_draft('settings','site',$1::jsonb,1)`, [JSON.stringify({ site_name: 'BLW York Hub', foundation_enroll_url: 'http://insecure.example/enrol' })]);
check('settings', 'non-https Foundation School link is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_save_draft('settings','site',$1::jsonb,1)`, [JSON.stringify({ site_name: 'BLW York Hub', foundation_enroll_url: 'https://rocksolidops.example/enroll', primary_color: '#C8102E', contact_email: 'hello@blwyork.example', socials: ['https://instagram.example/blwyork'] })]);
check('settings', 'valid settings draft is saved by the core administrator (settings.edit)', r.ok, r.error || '');
r = await as('authenticated', U.editor, `select web_save_draft('settings','site',$1::jsonb,2)`, [JSON.stringify({ site_name: 'Editor tries settings' })]);
check('settings', 'Website Editor cannot save settings (settings.edit is not in the Editor role)', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_publish_content('settings','site',2,'try')`);
check('settings', 'editor cannot publish settings', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.publisher, `select web_publish_content('settings','site',2,'Launch settings')`);
check('settings', 'publisher publishes settings (settings.publish)', r.ok, r.error || '');
r = await as('authenticated', U.admin, `select web_save_draft('settings','site',$1::jsonb,2)`, [JSON.stringify({ site_name: 'BLW York Hub', logo_url: 'javascript:alert(1)' })]);
check('settings', 'a javascript: logo address is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_save_draft('settings','site',$1::jsonb,2)`, [JSON.stringify({ site_name: 'BLW York Hub', hero_image_url: '/media/hero.jpg', logo_url: 'https://cdn.example/logo.png' })]);
check('settings', 'https and site-path image addresses are accepted', r.ok, r.error || '');

anon = await as('anon', null, `select body->>'foundation_enroll_url' u from public.v_public_content where kind='settings' and key='site'`);
check('settings', 'published Foundation School link reaches the public view', anon.ok && anon.rows[0]?.u === 'https://rocksolidops.example/enroll', JSON.stringify(anon.rows));

r = await as('authenticated', U.contributor, `select web_save_draft('page','about','{"title":"About"}'::jsonb,1)`);
check('content', 'contributor cannot edit pages', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.analyst, `select web_save_draft('page','about','{"title":"About"}'::jsonb,1)`);
check('content', 'analyst cannot edit pages', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.analyst, `select * from public.web_get_content('page','home')`);
check('content', 'analyst cannot read page drafts', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select count(*)::int n from public.web_versions`);
check('content', 'web_versions cannot be read directly by staff', refused(r) || r.rows?.[0]?.n === 0, r.error || 'table grant absent');
r = await as('authenticated', U.editor, `select count(*)::int n from public.web_content`);
check('content', 'web_content cannot be read or written directly', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select * from public.web_list_versions('page','home')`);
check('content', 'editor can list page history', r.ok && r.rows.length >= 2, r.error || JSON.stringify(r.rows.length));
r = await as('anon', null, `update public.web_content set draft = '{"title":"pwned"}'::jsonb`);
check('content', 'anonymous write to web_content is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('anon', null, `select web_save_draft('page','home','{"title":"x"}'::jsonb,1)`);
check('content', 'anonymous draft save is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('anon', null, `select * from public.web_get_content('page','home')`);
check('content', 'anonymous cannot read drafts through web_get_content', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('anon', null, `select count(*)::int n from public.v_public_content where kind = 'page' and key = 'about'`);
check('content', 'pages that were never published are absent from the public view', r.ok && r.rows[0].n === 0);

// =====================================================================================================================
// 3. Blog
// =====================================================================================================================
r = await as('authenticated', U.contributor, `select web_save_post(null,'what-god-did','What God Did','Excerpt here','Body text here','Events','Test author',null)`);
check('blog', 'contributor creates a post draft', r.ok && !!r.rows[0].web_save_post, r.error || '');
const postId = r.rows?.[0]?.web_save_post;
r = await as('authenticated', U.contributor, `select web_set_post_status($1,'published',null,1)`, [postId]);
check('blog', 'contributor cannot publish a post', refused(r), r.error || 'UNEXPECTED SUCCESS');
anon = await as('anon', null, `select count(*)::int n from public.v_public_posts where slug='what-god-did'`);
check('blog', 'a draft post is not visible to anonymous visitors', anon.ok && anon.rows[0].n === 0);
r = await as('authenticated', U.publisher, `select web_set_post_status($1,'published',null,1)`, [postId]);
check('blog', 'publisher publishes the post', r.ok, r.error || '');
anon = await as('anon', null, `select title from public.v_public_posts where slug='what-god-did'`);
check('blog', 'a published post is visible to anonymous visitors', anon.ok && anon.rows[0]?.title === 'What God Did', anon.error || JSON.stringify(anon.rows));
r = await as('authenticated', U.publisher, `select web_save_post($1,'what-god-did','What God Did','Excerpt here','Body text here','Events','Test author',2)`, [postId]);
r = await as('authenticated', U.publisher, `select web_set_post_status($1,'published','2099-01-01T00:00:00Z',3)`, [postId]);
anon = await as('anon', null, `select count(*)::int n from public.v_public_posts where slug='what-god-did'`);
check('blog', 'a post scheduled for the future is NOT visible yet', anon.ok && anon.rows[0].n === 0, JSON.stringify(anon.rows));
r = await as('authenticated', U.publisher, `select web_set_post_status($1,'draft',null,4)`, [postId]);
anon = await as('anon', null, `select count(*)::int n from public.v_public_posts where slug='what-god-did'`);
check('blog', 'unpublishing returns the post to draft and hides it', anon.ok && anon.rows[0].n === 0);
r = await as('authenticated', U.publisher, `insert into public.web_posts (slug,title,body,excerpt) values ('direct-insert-attempt','Direct','b','e')`);
check('blog', 'direct insert into web_posts is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.publisher, `select web_save_post(null,'bad slug!','T','','B','C','A',null)`);
check('blog', 'slug with spaces or symbols is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.publisher, `select web_save_post(null,'empty-body-post','T','','','C','A',null)`);
const emptyId = r.rows?.[0]?.web_save_post;
r = await as('authenticated', U.publisher, `select web_set_post_status($1,'published',null,1)`, [emptyId]);
check('blog', 'publishing a post with no excerpt or body is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');

// =====================================================================================================================
// 4. Public events
// =====================================================================================================================
r = await as('authenticated', U.editor, `select web_set_event_publication($1,false,false,'bible-study','', 'Dive deeper',null,0)`, [EV_ALL]);
check('events', 'editor (manage only) can prepare an event but not make it public', r.ok, r.error || '');
r = await as('authenticated', U.editor, `select web_set_event_publication($1,true,false,'bible-study','', 'Dive deeper',null,1)`, [EV_ALL]);
check('events', 'editor cannot make an event public (needs events.publish)', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.publisher, `select web_set_event_publication($1,true,true,'bible-study','', 'Dive deeper into the Word',null,1)`, [EV_ALL]);
check('events', 'publisher makes an open event public and featured', r.ok, r.error || '');
r = await as('authenticated', U.publisher, `select web_set_event_publication($1,true,false,'private-night','', 'x',null,0)`, [EV_MEET]);
check('events', 'a meeting-targeted event cannot be published on the website', refused(r), r.error || 'UNEXPECTED SUCCESS');
anon = await as('anon', null, `select slug, title, summary, featured from public.v_public_events`);
check('events', 'public events view lists the published open event', anon.ok && anon.rows.some((x) => x.slug === 'bible-study' && x.featured === true), anon.error || JSON.stringify(anon.rows));
check('events', 'public events view omits the targeted event', anon.ok && !anon.rows.some((x) => x.slug === 'private-night'));
const cols = await owner(`select column_name from information_schema.columns where table_schema='public' and table_name='v_public_events' order by 1`);
const names = cols.rows.map((x) => x.column_name);
check('events', 'public events view exposes no creator, audience or RSVP fields', !names.some((n) => /created_by|audience|rsvp|attendee|notif/.test(n)), names.join(','));
r = await as('anon', null, `select * from public.web_event_publications`);
check('events', 'anonymous cannot read the event publication table', refused(r), r.error || 'UNEXPECTED SUCCESS');

// =====================================================================================================================
// 5. Inquiries and public-form protection
// =====================================================================================================================
const before = (await owner(`select count(*)::int n from public.web_inbound_submissions`)).rows[0].n;
r = await as('service_role', null, `select web_submit_inquiry('contact','Visitor One','visitor@example.org','','I would like to visit on Sunday','General inquiry','v1',$1,'')`, [HASH]);
check('inquiries', 'the trusted intake path accepts a Contact Us message with consent', r.ok, r.error || '');
r = await as('anon', null, `select web_submit_inquiry('contact','Direct','direct@example.org','','direct call','x','v1',$1,'')`, [HASH]);
check('inquiries', 'an anonymous visitor cannot call the intake function directly', refused(r), r.error || 'UNEXPECTED SUCCESS');
const after = (await owner(`select count(*)::int n from public.web_inbound_submissions`)).rows[0].n;
check('inquiries', 'the submission is stored', after === before + 1);
r = await as('service_role', null, `select web_submit_inquiry('contact','Bot','bot@example.org','','spam spam','x','v1',$1,'filled honeypot')`, [HASH]);
const afterBot = (await owner(`select count(*)::int n from public.web_inbound_submissions`)).rows[0].n;
check('inquiries', 'honeypot filled: accepted silently, nothing stored', r.ok && afterBot === after, `${afterBot}`);
r = await as('service_role', null, `select web_submit_inquiry('contact','No Consent','a@example.org','','hello','x','',$1,'')`, [HASH]);
check('inquiries', 'submission without consent version is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('service_role', null, `select web_submit_inquiry('contact','Bad Email','not-an-email','','hello','x','v1',$1,'')`, [HASH]);
check('inquiries', 'invalid email is refused by the table', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('service_role', null, `select web_submit_inquiry('contact','Hack','a@example.org','','hi','x','v1','not-a-hash','')`);
check('inquiries', 'consent text hash that is not a SHA-256 is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('service_role', null, `select web_submit_inquiry('admin','Hack','a@example.org','','hi','x','v1',$1,'')`, [HASH]);
check('inquiries', 'unknown form kind is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('anon', null, `select * from public.web_inbound_submissions`);
check('inquiries', 'anonymous cannot read submissions', refused(r), r.error || 'UNEXPECTED SUCCESS');
// Flood: the global kind-scoped limit is 60 per 10 minutes. Submission 61 must be refused.
let limited = null;
for (let i = 0; i < 70 && !limited; i++) {
  const x = await as('service_role', null, `select web_submit_inquiry('new_here','Flood ${i}','f${i}@example.org','','hello','x','v1',$1,'')`, [HASH]);
  if (!x.ok) limited = x;
}
check('inquiries', 'rate limit refuses submissions beyond the per-kind window', limited && /Too many/.test(limited.error || ''), limited?.error || 'NOT LIMITED');
const crmAfter = (await owner(`select (select count(*)::int from public.people) p, (select count(*)::int from public.contacts) c`)).rows[0];
check('inquiries', 'public submissions create no CRM people or contact rows', crmAfter.p === crmBefore.p && crmAfter.c === crmBefore.c, JSON.stringify({ crmBefore, crmAfter }));
r = await as('authenticated', U.editor, `select * from public.web_list_inquiries(null)`);
check('inquiries', 'editor cannot read inquiries (no submissions.review)', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.reviewer, `select count(*)::int n from public.web_list_inquiries(null)`);
check('inquiries', 'custom reviewer role reads inquiries', r.ok && r.rows[0].n > 0, r.error || '');
const firstInq = (await owner(`select id from public.web_inbound_submissions order by created_at limit 1`)).rows[0].id;
r = await as('authenticated', U.reviewer, `select web_set_inquiry_status($1,'in_review')`, [firstInq]);
check('inquiries', 'reviewer changes inquiry status', r.ok, r.error || '');
r = await as('authenticated', U.editor, `select web_set_inquiry_status($1,'closed')`, [firstInq]);
check('inquiries', 'editor cannot change inquiry status', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.reviewer, `select web_purge_expired_inquiries()`);
check('inquiries', 'staff cannot run the retention purge', refused(r), r.error || 'UNEXPECTED SUCCESS');

// =====================================================================================================================
// 6. Media
// =====================================================================================================================
r = await as('authenticated', U.contributor, `select web_register_media('site-media','${U.contributor}/hero/2026/photo.jpg','image/jpeg',120000,'')`);
check('media', 'image without alt text is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.contributor, `select web_register_media('site-media','${U.contributor}/hero/2026/photo.jpg','image/jpeg',120000,'Students at the welcome table')`);
check('media', 'contributor registers an image with alt text', r.ok, r.error || '');
r = await as('authenticated', U.contributor, `select web_register_media('site-media','${U.contributor}/docs/evil.pdf','application/pdf',1000,'pdf in images')`);
check('media', 'a PDF cannot be registered in the public image bucket', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.analyst, `select web_register_media('site-media','hero/x.jpg','image/jpeg',10,'x')`);
check('media', 'analyst cannot upload media', refused(r), r.error || 'UNEXPECTED SUCCESS');
const bk = await owner(`select id, public, array_to_string(allowed_mime_types, ',') m from storage.buckets where id in ('site-media','rhapsody-pdfs') order by id`);
check('media', 'site-media is public and images only', bk.rows.find((b) => b.id === 'site-media')?.public === true && !bk.rows.find((b) => b.id === 'site-media').m.includes('pdf'));
check('media', 'rhapsody-pdfs is private and PDF only', bk.rows.find((b) => b.id === 'rhapsody-pdfs')?.public === false && bk.rows.find((b) => b.id === 'rhapsody-pdfs').m === 'application/pdf');

// =====================================================================================================================
// 7. Coordinators, private Hub data, audit integrity and revocation
// =====================================================================================================================
r = await as('authenticated', U.coord, `select web_save_draft('page','home','{"title":"Coordinator edit"}'::jsonb,1)`);
check('authority', 'coordinator cannot edit website content', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.coord, `select web_publish_content('page','home',1,'coordinator publish')`);
check('authority', 'coordinator cannot publish', refused(r), r.error || 'UNEXPECTED SUCCESS');
// Existing Hub rules let every active member read some people rows (095). A website role must add nothing to that.
const editorPeople = await as('authenticated', U.editor, `select count(*)::int n from public.people`);
const memberPeople = await as('authenticated', U.member, `select count(*)::int n from public.people`);
check('privacy', 'website editor sees exactly what an ordinary member sees in people (no extra access)', editorPeople.ok && memberPeople.ok && editorPeople.rows[0].n === memberPeople.rows[0].n, `${editorPeople.rows?.[0]?.n} vs ${memberPeople.rows?.[0]?.n}`);
r = await as('authenticated', U.editor, `select count(*)::int n from public.contacts`);
check('privacy', 'website editor reads no CRM contacts', r.ok && r.rows[0].n === 0, r.error || JSON.stringify(r.rows));
r = await as('authenticated', U.editor, `select count(*)::int n from public.meeting_attendances`);
check('privacy', 'website editor reads no attendance records', r.ok && r.rows[0].n === 0, r.error || JSON.stringify(r.rows));
r = await as('authenticated', U.analyst, `select * from public.web_audit_log`);
check('audit', 'analyst cannot read the audit log', r.ok && r.rows.length === 0, r.error || JSON.stringify(r.rows.length));
r = await as('authenticated', U.admin, `select action from public.web_audit_log order by id`);
const actions = r.ok ? r.rows.map((x) => x.action) : [];
check('audit', 'website role creation, permission grants and assignments are audited', ['role.created', 'role.permission_granted', 'assignment.created', 'assignment.removed'].every((a) => actions.includes(a)), JSON.stringify(actions.slice(0, 8)));
check('audit', 'content publication is audited', actions.includes('content.published') && actions.includes('content.rolled_back'));
check('audit', 'post and event changes are audited', actions.includes('post.status_changed') && actions.includes('event.publication_changed'));
r = await owner(`update public.web_audit_log set action = 'tampered' where id = (select min(id) from public.web_audit_log)`).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('audit', 'audit rows cannot be updated, even by the owner', refused(r), r.error || 'UPDATED');
r = await owner(`delete from public.web_audit_log`).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('audit', 'audit rows cannot be deleted, even by the owner', refused(r), r.error || 'DELETED');

// Revocation takes effect on the next call. Removing an assignment is the revocation, and it is audited.
r = await as('authenticated', U.admin, `select web_unassign_website_role($1,'Editor role no longer needed')`, [editorAssignment]);
check('revocation', 'core administrator removes an assignment with a reason', r.ok, r.error || '');
r = await as('authenticated', U.editor, `select web_save_draft('page','home','{"title":"After revoke"}'::jsonb,1)`);
check('revocation', 'revoked editor is refused on the next call', refused(r) && /permission/i.test(r.error || ''), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_unassign_website_role($1,'x')`, [reviewerAssignment]);
check('revocation', 'revocation reason under 5 characters is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_unassign_website_role($1,'Reviewer no longer covers inquiries')`, [reviewerAssignment]);
check('revocation', 'core administrator removes the reviewer assignment', r.ok, r.error || '');
r = await as('authenticated', U.reviewer, `select count(*)::int n from public.web_list_inquiries(null)`);
check('revocation', 'former reviewer loses inquiry access immediately', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_assign_website_role($1,$2,'Editor role returns for the new term')`, [U.editor, ROLE.editor]);
check('revocation', 'a revoked person can be assigned again (new assignment row)', r.ok, r.error || '');

// Hub regression: the Hub permission constraint lists the ten Hub keys plus the fifteen website keys, and no role-management key.
const hubCheck = await owner(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.admin_role_permissions'::regclass and conname = 'admin_role_permissions_permission_key_check'`);
const keyCount = (hubCheck.rows[0]?.d.match(/'[a-z_]+(?:\.[a-z_]+)+'/g) || []).length;
check('hub', 'permission constraint lists 25 keys: 10 Hub and 15 website', keyCount === 25, `found ${keyCount}`);
check('hub', 'no website role-management key exists', !/website\.roles\.manage/.test(hubCheck.rows[0]?.d ?? ''));

// =====================================================================================================================
// 2b. Page unpublish (migration 116): withdraw from the public site, keep the draft and versions, republish
// =====================================================================================================================
r = await as('authenticated', U.editor, `select web_unpublish_content('page','home','Editor tries to withdraw the page')`);
check('unpublish', 'website editor cannot unpublish a page', refused(r) && /permission/i.test(r.error || ''), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.coord, `select web_unpublish_content('page','home','Coordinator tries to withdraw the page')`);
check('unpublish', 'coordinator without a publish key cannot unpublish a page', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.publisher, `select web_unpublish_content('page','home','Shor')`);
check('unpublish', 'unpublish with a reason under 5 characters is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.publisher, `select web_unpublish_content('settings','site','Settings cannot be unpublished')`);
check('unpublish', 'settings cannot be unpublished (only pages)', refused(r) && /Only pages/.test(r.error || ''), r.error || 'UNEXPECTED SUCCESS');

r = await as('authenticated', U.publisher, `select web_unpublish_content('page','home','Withdrawn for a rewrite')`);
check('unpublish', 'publisher unpublishes the page with a reason', r.ok, r.error || '');
anon = await as('anon', null, `select count(*)::int n from public.v_public_content where kind='page' and key='home'`);
check('unpublish', 'the page disappears from the public view at once', anon.ok && anon.rows[0].n === 0, anon.error || JSON.stringify(anon.rows));
r = await as('authenticated', U.publisher, `select web_unpublish_content('page','home','Withdrawn again')`);
check('unpublish', 'a second unpublish of the same page is refused (no misleading audit row)', refused(r) && /not published/.test(r.error || ''), r.error || 'UNEXPECTED SUCCESS');

// The draft and every version survive unpublish. Nothing is deleted.
const kept = await owner(`select (select count(*)::int from public.web_versions where kind='page' and key='home') v, (select draft is not null from public.web_content where kind='page' and key='home') d`);
check('unpublish', 'versions and the draft are kept after unpublish', kept.rows[0].v >= 2 && kept.rows[0].d === true, JSON.stringify(kept.rows[0]));
r = await as('anon', null, `select count(*)::int n from public.web_content`);
check('unpublish', 'anonymous visitors still cannot read the draft table after unpublish', refused(r) || r.rows?.[0]?.n === 0, r.error || JSON.stringify(r.rows));

const audit = await owner(`select count(*)::int n from public.web_audit_log where action = 'content.unpublished'`);
check('unpublish', 'each successful unpublish writes one audit row', audit.rows[0].n === 1, `found ${audit.rows[0].n}`);

const dv = (await owner(`select draft_version v from public.web_content where kind='page' and key='home'`)).rows[0].v;
r = await as('authenticated', U.publisher, `select web_publish_content('page','home',$1,'Back on the site after the rewrite')`, [dv]);
check('unpublish', 'publisher republishes the kept draft', r.ok, r.error || '');
anon = await as('anon', null, `select count(*)::int n from public.v_public_content where kind='page' and key='home'`);
check('unpublish', 'the republished page is visible again', anon.ok && anon.rows[0].n === 1, anon.error || JSON.stringify(anon.rows));

r = await as('authenticated', U.admin, `select web_unpublish_content('page','home','Core administrator withdraws the page')`);
check('unpublish', 'a core administrator can unpublish a page', r.ok, r.error || '');
const latestVersion = (await owner(`select id from public.web_versions where kind='page' and key='home' order by version_no desc limit 1`)).rows[0].id;
r = await as('authenticated', U.publisher, `select web_rollback_content('page','home',$1,'Restore the latest version after the check')`, [latestVersion]);
check('unpublish', 'rollback restores a page after unpublish', r.ok, r.error || '');

// =====================================================================================================================
// 2c. Anonymous execution and direct reads (migration 115 security remediation, carried into the integrated chain)
// =====================================================================================================================
const SENSITIVE = [
  `select web_list_inquiries(null)`,
  `select web_set_inquiry_status(gen_random_uuid(),'closed')`,
  `select web_save_draft('page','home','{}'::jsonb,1)`,
  `select web_publish_content('page','home',1,'anon publish')`,
  `select web_unpublish_content('page','home','anon withdraw')`,
  `select web_rollback_content('page','home',gen_random_uuid(),'anon rollback')`,
  `select web_list_versions('page','home')`,
  `select web_get_content('page','home')`,
  `select web_save_post(null,'anon-post','t','e','b','c','a',null)`,
  `select web_set_post_status(gen_random_uuid(),'published',null,1)`,
  `select web_list_posts()`,
  `select web_set_event_publication(gen_random_uuid(),true,false,'s','t','s','',1)`,
  `select web_list_event_publications()`,
  `select web_register_media('site-media','anon/x.png','image/png',1,'alt')`,
  `select web_list_media()`,
  `select web_save_edition(null,'monthly','2026-01-01','t','d',null,1)`,
  `select web_list_editions()`,
  `select web_download_stats(30)`,
  `select web_record_download(gen_random_uuid(),'src','','','h')`,
  `select web_create_website_role('anon','', array[]::text[], 'anon role attempt')`,
  `select web_set_website_permission(gen_random_uuid(),'website.pages.edit',true,'anon grant attempt')`,
  `select web_assign_website_role(gen_random_uuid(),gen_random_uuid(),'anon assign attempt')`,
  `select web_unassign_website_role(gen_random_uuid(),'anon unassign attempt')`,
  `select web_list_website_roles()`,
  `select web_list_website_assignments()`,
  `select web_my_permissions()`,
  `select web_purge_expired_inquiries()`,
];
let anonRefused = 0;
const anonLeaks = [];
for (const sql of SENSITIVE) {
  const res = await as('anon', null, sql);
  if (refused(res)) anonRefused += 1; else anonLeaks.push(sql.slice(0, 60));
}
check('security', `anonymous visitors are refused on all ${SENSITIVE.length} sensitive website functions`, anonLeaks.length === 0 && anonRefused === SENSITIVE.length, anonLeaks.join(' | '));

const BASE_TABLES = ['web_content', 'web_versions', 'web_posts', 'web_event_publications', 'web_media', 'web_rhapsody_editions', 'web_inbound_submissions', 'web_audit_log', 'admin_roles', 'admin_role_assignments'];
let tableLeaks = [];
for (const t of BASE_TABLES) {
  const res = await as('anon', null, `select count(*) from public.${t}`);
  if (res.ok) tableLeaks.push(t);
}
check('security', 'anonymous visitors cannot read any website or Hub RBAC base table', tableLeaks.length === 0, tableLeaks.join(', '));

// A signed-in member with no website role is refused on staff functions, and the scheduled cleanup is service-role only.
const memberChecks = [
  `select web_list_inquiries(null)`,
  `select web_download_stats(30)`,
  `select web_save_draft('page','home','{}'::jsonb,1)`,
  `select web_purge_expired_inquiries()`,
];
const memberLeaks = [];
for (const sql of memberChecks) {
  const res = await as('authenticated', U.member, sql);
  if (!refused(res)) memberLeaks.push(sql.slice(0, 60));
}
check('security', 'a signed-in member with no website role is refused on every staff function', memberLeaks.length === 0, memberLeaks.join(' | '));
const memberRead = await as('authenticated', U.member, `select count(*)::int n from public.web_content`);
check('security', 'a signed-in member cannot read draft content', refused(memberRead), memberRead.error || 'UNEXPECTED SUCCESS');

// ---- Rhapsody (migration 111)
// Rhapsody and analytics checks for migration 111. Spliced into website_d2_pglite_test.mjs before its summary.
// Uses the same accounts, helpers and role seeds as the main suite.

{
  const area = 'rhapsody';
  let rr;
  // A PDF in the private bucket (contributor has media.upload).
  rr = await as('authenticated', U.contributor, `select web_register_media('rhapsody-pdfs','${U.contributor}/rhapsody/2026-10.pdf','application/pdf',482211,'')`);
  check(area, 'a contributor without rhapsody.manage cannot register a Rhapsody PDF', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.editor, `select web_register_media('rhapsody-pdfs','${U.editor}/rhapsody/2026-10.pdf','application/pdf',482211,'')`);
  check(area, 'an editor (rhapsody.manage) registers a Rhapsody PDF in their own folder', rr.ok, rr.error || '');
  const pdfId = rr.rows?.[0]?.web_register_media;
  rr = await as('authenticated', U.editor, `select web_save_edition(null,'monthly','2026-10-01','October 2026','Daily readings for October',null,0)`);
  check(area, 'editor creates an edition (manage permission)', rr.ok && !!rr.rows[0].web_save_edition, rr.error || '');
  const edId = rr.rows?.[0]?.web_save_edition;
  rr = await as('authenticated', U.editor, `select web_save_edition($1,'monthly','2026-10-01','October 2026','x',$2,1)`, [edId, pdfId]);
  check(area, 'editor attaches the PDF to the edition', rr.ok, rr.error || '');
  rr = await as('authenticated', U.editor, `select web_set_edition_status($1,'published',2)`, [edId]);
  check(area, 'editor cannot publish an edition (needs rhapsody.publish)', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.publisher, `select web_set_edition_status($1,'published',2)`, [edId]);
  check(area, 'publisher cannot publish an edition without a named authorizer', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.publisher, `select web_authorize_edition($1,'',2)`, [edId]);
  check(area, 'authorization needs the authorizer name', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.editor, `select web_authorize_edition($1,'Pastor Test',2)`, [edId]);
  check(area, 'editor cannot authorize an edition (needs rhapsody.publish)', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.publisher, `select web_authorize_edition($1,'Pastor Test',2)`, [edId]);
  check(area, 'publisher records the authorizer', rr.ok, rr.error || '');
  rr = await as('authenticated', U.publisher, `select web_set_edition_status($1,'published',3)`, [edId]);
  check(area, 'publisher publishes an authorized edition with a PDF', rr.ok, rr.error || '');

  // Public view: published editions only, no storage path.
  let pub = await as('anon', null, `select edition_id, title, authorized_by from public.v_public_editions`);
  check(area, 'anonymous visitors see the published edition', pub.ok && pub.rows.some((x) => x.title === 'October 2026' && x.authorized_by === 'Pastor Test'), pub.error || JSON.stringify(pub.rows));
  const cols = (await owner(`select column_name from information_schema.columns where table_schema='public' and table_name='v_public_editions'`)).rows.map((x) => x.column_name);
  check(area, 'public editions view exposes no storage path or PDF identifier', !cols.some((c) => /path|pdf|storage/.test(c)), cols.join(','));
  rr = await as('anon', null, `select pdf_media_id from public.web_rhapsody_editions`);
  check(area, 'anonymous cannot read the edition table', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.analyst, `select * from public.web_list_editions()`);
  check(area, 'analyst cannot list the Rhapsody library', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
rr = await as('authenticated', U.editor, `select pdf_path from public.web_list_editions()`);
  check(area, 'rhapsody staff see the stored PDF path in the staff listing', rr.ok && rr.rows.some((x) => x.pdf_path === `${U.editor}/rhapsody/2026-10.pdf`), rr.error || JSON.stringify(rr.rows));

  // Click tracking.
  const H = (n) => createHash('sha256').update('visitor-' + n).digest('hex');
  rr = await as('anon', null, `select web_record_download($1,'home','newsletter','oct',$2)`, [edId, H(0)]);
  check(area, 'an anonymous browser cannot record a download click', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('service_role', null, `select web_record_download($1,'home','newsletter','oct','${'z'.repeat(10)}')`, [edId]);
  check(area, 'a click with a malformed visitor token is refused', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('service_role', null, `select web_record_download($1,'home','newsletter','oct',$2)`, [edId, H(1)]);
  check(area, 'the trusted PDF function records a download click', rr.ok, rr.error || '');
  for (let i = 2; i <= 5; i++) await as('service_role', null, `select web_record_download($1,'home','newsletter','oct',$2)`, [edId, H(i)]);
  const clicks = (await owner(`select count(*)::int n from public.web_download_events where edition_id = $1`, [edId])).rows[0].n;
  check(area, 'five clicks from five visitors are stored', clicks === 5, `${clicks}`);
  rr = await as('service_role', null, `select web_record_download($1,'home','x','x',$2)`, ['00000000-0000-4000-8000-00000000dead', H(9)]);
  check(area, 'a click on an unknown edition is refused', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.editor, `insert into public.web_download_events (edition_id, visitor_hash) values ($1,$2)`, [edId, H(7)]);
  check(area, 'staff cannot insert click rows directly', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  const tamper = await owner(`update public.web_download_events set source = 'x'`).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
  check(area, 'click rows cannot be altered, even by the owner', refused(tamper), tamper.error || 'UPDATED');

  // Analytics: aggregated, thresholded, staff-only.
  rr = await as('authenticated', U.analyst, `select edition_id, title, clicks, approx_visitors from public.web_download_stats(30)`);
  check(area, 'analyst reads aggregated click statistics', rr.ok && rr.rows.some((x) => x.title === 'October 2026' && Number(x.clicks) === 5), rr.error || JSON.stringify(rr.rows));
  check(area, 'five visitors are reported as a number', rr.ok && rr.rows.some((x) => x.approx_visitors === '5'), JSON.stringify(rr.rows));
  rr = await as('authenticated', U.editor, `select * from public.web_download_stats(30)`);
  check(area, 'editor cannot read analytics (no analytics.view)', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.analyst, `select * from public.web_download_stats(0)`);
  check(area, 'analytics window must be between 1 and 365 days', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.analyst, `select visitor_hash from public.web_download_events limit 1`);
  check(area, 'analyst cannot read raw visitor hashes', refused(rr), rr.error || 'UNEXPECTED SUCCESS');

  // Few visitors are withheld (a second edition with two visitors).
  const edTwo = (await as('authenticated', U.editor, `select web_save_edition(null,'daily','2026-10-15','15 October 2026','',null,0)`)).rows[0].web_save_edition;
  const pdf2 = (await as('authenticated', U.editor, `select web_register_media('rhapsody-pdfs','${U.editor}/rhapsody/2026-10-15.pdf','application/pdf',1000,'')`)).rows[0].web_register_media;
  await as('authenticated', U.editor, `select web_save_edition($1,'daily','2026-10-15','15 October 2026','',$2,1)`, [edTwo, pdf2]);
  await as('authenticated', U.publisher, `select web_authorize_edition($1,'Pastor Test',2)`, [edTwo]);
  await as('authenticated', U.publisher, `select web_set_edition_status($1,'published',3)`, [edTwo]);
  await as('service_role', null, `select web_record_download($1,'home','x','x',$2)`, [edTwo, H(31)]);
  await as('service_role', null, `select web_record_download($1,'home','x','x',$2)`, [edTwo, H(32)]);
  rr = await as('authenticated', U.analyst, `select title, approx_visitors from public.web_download_stats(30)`);
  check(area, 'fewer than five visitors are withheld as "fewer than 5"', rr.ok && rr.rows.some((x) => x.title === '15 October 2026' && x.approx_visitors === 'fewer than 5'), JSON.stringify(rr.rows));

  // Audit trail for the Rhapsody decisions.
  const aud = await as('authenticated', U.admin, `select action from public.web_audit_log`);
  check(area, 'authorization and publication are audited', aud.ok && aud.rows.some((x) => x.action === 'rhapsody.authorized') && aud.rows.some((x) => x.action === 'rhapsody.status_changed'), aud.error || '');
}


// ---------- Edge support (migration 112): client limits, upload permission, PDF resolver
{
  const area = 'edge';
  const CLIENT_A = createHash('sha256').update('client-a').digest('hex');
  const CLIENT_B = createHash('sha256').update('client-b').digest('hex');

  // Per-client limits: service role only, bounded inputs, fixed windows.
  let rr = await as('anon', null, `select web_consume_client_limit($1,'inquiry',2,10)`, [CLIENT_A]);
  check(area, 'anon cannot call the per-client limiter', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.admin, `select web_consume_client_limit($1,'inquiry',2,10)`, [CLIENT_A]);
  check(area, 'signed-in admin cannot call the per-client limiter', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  const first = await as('service_role', null, `select web_consume_client_limit($1,'inquiry',2,10) as ok`, [CLIENT_A]);
  const second = await as('service_role', null, `select web_consume_client_limit($1,'inquiry',2,10) as ok`, [CLIENT_A]);
  const third = await as('service_role', null, `select web_consume_client_limit($1,'inquiry',2,10) as ok`, [CLIENT_A]);
  check(area, 'within the limit the call is allowed', first.ok && first.rows[0].ok === true && second.rows[0].ok === true, first.error || '');
  check(area, 'over the limit the call is refused', third.ok && third.rows[0].ok === false, JSON.stringify(third.rows));
  const other = await as('service_role', null, `select web_consume_client_limit($1,'inquiry',2,10) as ok`, [CLIENT_B]);
  check(area, 'another client has its own allowance', other.ok && other.rows[0].ok === true, other.error || '');
  const otherScope = await as('service_role', null, `select web_consume_client_limit($1,'other',1,10) as ok`, [CLIENT_A]);
  check(area, 'limits are separate per scope', otherScope.ok && otherScope.rows[0].ok === true, otherScope.error || '');
  rr = await as('service_role', null, `select web_consume_client_limit('not-a-hash','inquiry',2,10)`);
  check(area, 'a malformed client identifier is refused', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('service_role', null, `select web_consume_client_limit($1,'inquiry',0,10)`, [CLIENT_A]);
  check(area, 'a zero limit is refused', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('service_role', null, `select web_consume_client_limit($1,'inquiry',2,0)`, [CLIENT_A]);
  check(area, 'a zero window is refused', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.admin, `select count(*) from public.web_client_rate_limits`);
  check(area, 'the limit table itself is not readable by signed-in users', refused(rr), rr.error || 'UNEXPECTED SUCCESS');

  // Media upload permission, asked as the user.
  rr = await as('authenticated', U.contributor, `select web_media_upload_allowed('site-media') as ok`);
  check(area, 'contributor may upload site images', rr.ok && rr.rows[0].ok === true, rr.error || JSON.stringify(rr.rows));
  rr = await as('authenticated', U.contributor, `select web_media_upload_allowed('rhapsody-pdfs') as ok`);
  check(area, 'contributor may not upload Rhapsody PDFs (no rhapsody.manage)', rr.ok && rr.rows[0].ok === false, rr.error || JSON.stringify(rr.rows));
  rr = await as('authenticated', U.pending, `select web_media_upload_allowed('site-media') as ok`);
  check(area, 'a pending applicant may not upload anything', rr.ok && rr.rows[0].ok === false, rr.error || JSON.stringify(rr.rows));
  rr = await as('authenticated', U.member, `select web_media_upload_allowed('site-media') as ok`);
  check(area, 'a member without a website role may not upload', rr.ok && rr.rows[0].ok === false, rr.error || JSON.stringify(rr.rows));
  rr = await as('authenticated', U.admin, `select web_media_upload_allowed('../etc') as ok`);
  check(area, 'an unknown bucket is refused even for the admin', rr.ok && rr.rows[0].ok === false, rr.error || JSON.stringify(rr.rows));
  rr = await as('anon', null, `select web_media_upload_allowed('site-media')`);
  check(area, 'anon cannot ask about uploads', refused(rr), rr.error || 'UNEXPECTED SUCCESS');

  // Rhapsody PDF resolver: only a published, authorized edition with an active PDF.
  const pdfId = (await as('authenticated', U.editor, `select web_register_media('rhapsody-pdfs','${U.editor}/rhapsody/edge-test.pdf','application/pdf',2000,'')`)).rows[0].web_register_media;
  const edId = (await as('authenticated', U.admin, `select web_save_edition(null,'daily','2026-11-01','Edge test edition','',$1,0)`, [pdfId])).rows[0].web_save_edition;
  let resolved = await as('service_role', null, `select * from public.web_resolve_edition_pdf($1)`, [edId]);
  check(area, 'an unpublished edition resolves to no PDF', resolved.ok && resolved.rows.length === 0, resolved.error || JSON.stringify(resolved.rows));
  let v = (await owner(`select version from public.web_rhapsody_editions where id = $1`, [edId])).rows[0].version;
  await as('authenticated', U.publisher, `select web_authorize_edition($1,'Pastor Edge',$2)`, [edId, v]);
  v = (await owner(`select version from public.web_rhapsody_editions where id = $1`, [edId])).rows[0].version;
  await as('authenticated', U.publisher, `select web_set_edition_status($1,'published',$2)`, [edId, v]);
  resolved = await as('service_role', null, `select * from public.web_resolve_edition_pdf($1)`, [edId]);
  check(area, 'a published, authorized edition resolves to its private path', resolved.ok && resolved.rows.length === 1 && resolved.rows[0].storage_path === `${U.editor}/rhapsody/edge-test.pdf` && resolved.rows[0].storage_bucket === 'rhapsody-pdfs', resolved.error || JSON.stringify(resolved.rows));
  rr = await as('authenticated', U.admin, `select * from public.web_resolve_edition_pdf($1)`, [edId]);
  check(area, 'signed-in users cannot resolve the private path directly', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('anon', null, `select * from public.web_resolve_edition_pdf($1)`, [edId]);
  check(area, 'anon cannot resolve the private path directly', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  await owner(`update public.web_media set status = 'archived' where id = $1`, [pdfId]);
  resolved = await as('service_role', null, `select * from public.web_resolve_edition_pdf($1)`, [edId]);
  check(area, 'an archived PDF is no longer served', resolved.ok && resolved.rows.length === 0, resolved.error || JSON.stringify(resolved.rows));
  await owner(`update public.web_media set status = 'active' where id = $1`, [pdfId]);
}

// ---------- Content links (migration 108, web_content section links): empty, long and unsafe section links
{
  const area = 'links105';
  const cur = (await as('authenticated', U.editor, `select draft_version from public.web_get_content('page','what_we_do')`)).rows[0];
  const v0 = Number(cur?.draft_version ?? 1);
  const body = (url) => ({ title: 'Links', sections: [{ type: 'text', heading: 'h', body: 'b', url, visible: true }] });
  let rr = await as('authenticated', U.editor, `select web_save_draft('page','what_we_do',$1::jsonb,$2)`, [JSON.stringify(body('')), v0]);
  check(area, 'a section with no link is accepted (the editor default)', rr.ok, rr.error || '');
  const longUrl = 'https://example.org/' + 'a'.repeat(300);
  rr = await as('authenticated', U.editor, `select web_save_draft('page','what_we_do',$1::jsonb,$2)`, [JSON.stringify(body(longUrl)), v0 + 1]);
  check(area, 'a long https link within 500 characters is accepted', rr.ok, rr.error || '');
  rr = await as('authenticated', U.editor, `select web_save_draft('page','what_we_do',$1::jsonb,$2)`, [JSON.stringify(body('javascript:alert(1)')), v0 + 2]);
  check(area, 'a script link is refused', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.editor, `select web_save_draft('page','what_we_do',$1::jsonb,$2)`, [JSON.stringify(body('https://example.org/' + 'a'.repeat(600))), v0 + 2]);
  check(area, 'a link over 500 characters is refused', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
}

// ---------- Migration 113: verified registration and orphaned-upload discovery
{
  const area = 'media110';
  autoStage = false;
  let rr = await as('authenticated', U.contributor, `select web_register_media('site-media','never/uploaded.jpg','image/jpeg',500,'Alt')`);
  check(area, 'registration refuses a file that was never uploaded', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  await owner(`insert into storage.objects (bucket_id, name, metadata) values ('site-media','${U.contributor}/verify/size.jpg','{"size":"100","mimetype":"image/jpeg"}')`);
  rr = await as('authenticated', U.contributor, `select web_register_media('site-media','${U.contributor}/verify/size.jpg','image/jpeg',999,'Alt')`);
  check(area, 'registration refuses a size that differs from the stored object', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.contributor, `select web_register_media('site-media','${U.contributor}/verify/size.jpg','image/png',100,'Alt')`);
  check(area, 'registration refuses a type that differs from the stored object', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('authenticated', U.contributor, `select web_register_media('site-media','${U.contributor}/verify/size.jpg','image/jpeg',100,'Alt')`);
  check(area, 'a matching stored object registers', rr.ok, rr.error || '');
  autoStage = true;

  // Orphans: old, unreferenced objects only.
  const old = `now() - interval '3 days'`;
  await owner(`insert into storage.objects (bucket_id, name, metadata, created_at) values
    ('site-media','orphan/old.jpg','{"size":"10","mimetype":"image/jpeg"}', ${old}),
    ('site-media','orphan/recent.jpg','{"size":"10","mimetype":"image/jpeg"}', now()),
    ('site-media','orphan/referenced-in-content.jpg','{"size":"10","mimetype":"image/jpeg"}', ${old}),
    ('site-media','${U.contributor}/verify/size.jpg','{"size":"100","mimetype":"image/jpeg"}', ${old})`);
  await owner(`update public.web_content set draft = draft || '{"hero_image_url":"/storage/orphan/referenced-in-content.jpg"}'::jsonb where kind='settings' and key='site'`);
  rr = await as('service_role', null, `select bucket_id, object_name from public.web_orphaned_uploads(1440)`);
  const names = rr.ok ? rr.rows.map((x) => x.object_name) : [];
  check(area, 'an old unreferenced upload is listed for cleanup', names.includes('orphan/old.jpg'), rr.error || JSON.stringify(names));
  check(area, 'a recent upload is not listed yet', !names.includes('orphan/recent.jpg'), JSON.stringify(names));
  check(area, 'an upload mentioned in website content is never listed', !names.includes('orphan/referenced-in-content.jpg'), JSON.stringify(names));
  check(area, 'a registered (referenced) asset is never listed', !names.includes('verify/size.jpg'), JSON.stringify(names));
  rr = await as('authenticated', U.admin, `select * from public.web_orphaned_uploads(1440)`);
  check(area, 'signed-in users cannot list orphaned uploads', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('anon', null, `select * from public.web_orphaned_uploads(1440)`);
  check(area, 'anon cannot list orphaned uploads', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
}

// ---------- Migration 114: revalidation before each deletion
{
  const area = 'reval111';
  const old = "now() - interval '3 days'";
  await owner(`insert into storage.objects (bucket_id, name, metadata, created_at) values
    ('site-media','reval/still-orphan.jpg','{"size":"10","mimetype":"image/jpeg"}', ${old}),
    ('site-media','reval/now-referenced.jpg','{"size":"10","mimetype":"image/jpeg"}', ${old}),
    ('site-media','reval/recent.jpg','{"size":"10","mimetype":"image/jpeg"}', now())`);
  let rr = await as('service_role', null, `select public.web_upload_still_unreferenced('site-media','reval/still-orphan.jpg',1440) as ok`);
  check(area, 'an old unreferenced upload is still a deletion candidate', rr.ok && rr.rows[0].ok === true, rr.error || JSON.stringify(rr.rows));
  await owner(`update public.web_content set draft = draft || '{"hero_image_url":"/storage/reval/now-referenced.jpg"}'::jsonb where kind='settings' and key='site'`);
  rr = await as('service_role', null, `select public.web_upload_still_unreferenced('site-media','reval/now-referenced.jpg',1440) as ok`);
  check(area, 'an upload referenced after the snapshot is no longer a candidate', rr.ok && rr.rows[0].ok === false, rr.error || JSON.stringify(rr.rows));
  rr = await as('service_role', null, `select public.web_upload_still_unreferenced('site-media','reval/recent.jpg',1440) as ok`);
  check(area, 'a recent upload is never a candidate', rr.ok && rr.rows[0].ok === false, rr.error || JSON.stringify(rr.rows));
  rr = await as('service_role', null, `select public.web_upload_still_unreferenced('site-media','reval/still-orphan.jpg',60) as ok`);
  check(area, 'the 24-hour minimum age cannot be shortened', rr.ok ? rr.rows[0].ok === false : true, rr.error || JSON.stringify(rr.rows));
  rr = await as('authenticated', U.admin, `select public.web_upload_still_unreferenced('site-media','reval/still-orphan.jpg',1440)`);
  check(area, 'signed-in users cannot ask revalidation questions', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
  rr = await as('anon', null, `select public.web_upload_still_unreferenced('site-media','reval/still-orphan.jpg',1440)`);
  check(area, 'anon cannot ask revalidation questions', refused(rr), rr.error || 'UNEXPECTED SUCCESS');
}

const failed = out.filter((x) => !x.ok);
console.log(`\nD2 DATABASE TESTS: ${out.length - failed.length}/${out.length} passed`);
if (failed.length) console.log('FAILED:\n' + failed.map((f) => `  [${f.area}] ${f.name}`).join('\n'));
process.exit(failed.length ? 1 : 0);
