// Website Management (Phase D2) database tests. Replays every migration in supabase/migrations (000-107) on a disposable
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
const as = (role, uid, sql, params = []) => attempt(db, role, uid, sql, params);
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

// =====================================================================================================================
// 1. Core administrator authority and role management
// =====================================================================================================================
let r = await as('authenticated', U.admin, `select web_is_core_admin() v`);
check('roles', 'core administrator is recognised', r.ok && r.rows[0].v === true);
r = await as('authenticated', U.coord, `select web_is_core_admin() v`);
check('roles', 'coordinator is NOT a core website administrator', r.ok && r.rows[0].v === false);
r = await as('authenticated', U.coord, `select * from public.web_my_permissions()`);
check('roles', 'coordinator holds no website permissions by default', r.ok && r.rows.length === 0, JSON.stringify(r.rows));

r = await as('authenticated', U.coord, `select web_create_role('Coordinator role','',array['website.analytics.view']::text[])`);
check('roles', 'coordinator cannot create a website role', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `select web_create_role('Editor role','',array['website.analytics.view']::text[])`);
check('roles', 'website editor cannot create a website role', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_create_role('Bad', '', array['website.everything']::text[])`);
check('roles', 'unknown permission key is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_create_role('Too many', '', array_fill('website.analytics.view'::text, array[17]))`);
check('roles', 'more than 16 permissions is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');

r = await as('authenticated', U.admin, `select web_create_role('Newsletter reviewer', 'Reviews inquiries only', array['website.submissions.review']::text[])`);
check('roles', 'core administrator creates a custom role', r.ok && !!r.rows[0].web_create_role, r.error || '');
const customRole = r.rows?.[0]?.web_create_role;

r = await as('authenticated', U.admin, `select web_assign_role($1,$2,'Assigned to review inquiries')`, [U.reviewer, customRole]);
check('roles', 'core administrator assigns a custom role with a reason', r.ok, r.error || '');
const reviewerAssignment = r.rows?.[0]?.web_assign_role;
r = await as('authenticated', U.admin, `select web_assign_role($1,$2,'Assigned to myself test')`, [U.admin, ROLE.analyst]);
check('roles', 'self-assignment is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_assign_role($1,$2,'x')`, [U.editor, ROLE.editor]);
check('roles', 'assignment with a reason under 5 characters is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_assign_role($1,$2,'Pending person should not get a role')`, [U.pending, ROLE.editor]);
check('roles', 'assignment to a pending account is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');

r = await as('authenticated', U.admin, `select web_assign_role($1,$2,'Editing the homepage text this term')`, [U.editor, ROLE.editor]);
check('roles', 'core administrator assigns the Website Editor role', r.ok, r.error || '');
const editorAssignment = r.rows?.[0]?.web_assign_role;
// Publisher, contributor and analyst are assigned here so that the later sections exercise their real permissions.
for (const [who, role, why] of [['publisher', ROLE.publisher, 'Publishing the spring content'], ['contributor', ROLE.contributor, 'Writing blog drafts this term'], ['analyst', ROLE.analyst, 'Reporting on downloads']]) {
  const a = await as('authenticated', U.admin, `select web_assign_role($1,$2,$3)`, [U[who], role, why]);
  check('roles', `core administrator assigns the ${who} role`, a.ok, a.error || '');
}
r = await as('authenticated', U.editor, `select * from public.web_my_permissions()`);
const editorPerms = r.ok ? r.rows.map((x) => x.permission_key) : [];
check('roles', 'editor holds content edit permissions', editorPerms.includes('website.pages.edit') && editorPerms.includes('website.blog.edit'), JSON.stringify(editorPerms));
check('roles', 'editor holds no publish permission', !editorPerms.some((k) => k.endsWith('.publish')), JSON.stringify(editorPerms));
check('roles', 'editor holds no website role-management power', !editorPerms.includes('website.roles.manage'));

// Direct table access is refused for website roles and for everyone else.
r = await as('authenticated', U.editor, `insert into public.web_role_assignments (role_id,profile_id,assigned_by,reason) values ($1,$2,$3,'Self escalation attempt')`, [ROLE.admin, U.editor, U.editor]);
check('roles', 'editor cannot insert a role assignment directly', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `insert into public.web_role_permissions (role_id,permission_key) values ($1,'website.roles.manage')`, [ROLE.editor]);
check('roles', 'editor cannot add a permission to a role directly', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.editor, `update public.web_roles set name = 'Owner' where id = $1`, [ROLE.editor]);
check('roles', 'editor cannot rename a role directly', refused(r) || r.rows?.length === 0, r.error || 'updated 0 rows is also refused');
r = await as('authenticated', U.editor, `select count(*)::int n from public.web_role_assignments`);
check('roles', 'editor sees only their own assignments (RLS)', r.ok && r.rows[0].n === 1, JSON.stringify(r.rows));
r = await as('authenticated', U.editor, `update public.profiles set role = 'admin' where id = $1`, [U.editor]);
check('roles', 'editor cannot promote their own Hub role through a website role', refused(r) || r.rows?.length === 0, r.error || 'updated 0 rows is also refused');
const editorAdmins = await as('authenticated', U.editor, `select count(*)::int n from public.profiles where role = 'admin'`);
const memberAdmins = await as('authenticated', U.member, `select count(*)::int n from public.profiles where role = 'admin'`);
check('roles', 'website role adds no Hub profile visibility (same as an ordinary member)', editorAdmins.ok && memberAdmins.ok && editorAdmins.rows[0].n === memberAdmins.rows[0].n, `${editorAdmins.rows?.[0]?.n} vs ${memberAdmins.rows?.[0]?.n}`);

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
r = await as('anon', null, `select web_submit_inquiry('contact','Visitor One','visitor@example.org','','I would like to visit on Sunday','General inquiry','v1',$1,'')`, [HASH]);
check('inquiries', 'anonymous visitor submits a Contact Us message with consent', r.ok, r.error || '');
const after = (await owner(`select count(*)::int n from public.web_inbound_submissions`)).rows[0].n;
check('inquiries', 'the submission is stored', after === before + 1);
r = await as('anon', null, `select web_submit_inquiry('contact','Bot','bot@example.org','','spam spam','x','v1',$1,'filled honeypot')`, [HASH]);
const afterBot = (await owner(`select count(*)::int n from public.web_inbound_submissions`)).rows[0].n;
check('inquiries', 'honeypot filled: accepted silently, nothing stored', r.ok && afterBot === after, `${afterBot}`);
r = await as('anon', null, `select web_submit_inquiry('contact','No Consent','a@example.org','','hello','x','',$1,'')`, [HASH]);
check('inquiries', 'submission without consent version is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('anon', null, `select web_submit_inquiry('contact','Bad Email','not-an-email','','hello','x','v1',$1,'')`, [HASH]);
check('inquiries', 'invalid email is refused by the table', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('anon', null, `select web_submit_inquiry('contact','Hack','a@example.org','','hi','x','v1','not-a-hash','')`);
check('inquiries', 'consent text hash that is not a SHA-256 is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('anon', null, `select web_submit_inquiry('admin','Hack','a@example.org','','hi','x','v1',$1,'')`, [HASH]);
check('inquiries', 'unknown form kind is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('anon', null, `select * from public.web_inbound_submissions`);
check('inquiries', 'anonymous cannot read submissions', refused(r), r.error || 'UNEXPECTED SUCCESS');
// Flood: the global kind-scoped limit is 60 per 10 minutes. Submission 61 must be refused.
let limited = null;
for (let i = 0; i < 70 && !limited; i++) {
  const x = await as('anon', null, `select web_submit_inquiry('new_here','Flood ${i}','f${i}@example.org','','hello','x','v1',$1,'')`, [HASH]);
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
r = await as('authenticated', U.contributor, `select web_register_media('site-media','hero/2026/photo.jpg','image/jpeg',120000,'')`);
check('media', 'image without alt text is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.contributor, `select web_register_media('site-media','hero/2026/photo.jpg','image/jpeg',120000,'Students at the welcome table')`);
check('media', 'contributor registers an image with alt text', r.ok, r.error || '');
r = await as('authenticated', U.contributor, `select web_register_media('site-media','docs/evil.pdf','application/pdf',1000,'pdf in images')`);
check('media', 'a PDF cannot be registered in the public image bucket', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.analyst, `select web_register_media('site-media','hero/x.jpg','image/jpeg',10,'x')`);
check('media', 'analyst cannot upload media', refused(r), r.error || 'UNEXPECTED SUCCESS');
const bk = await owner(`select id, public, array_to_string(allowed_mime_types, ',') m from storage.buckets where id in ('site-media','rhapsody-pdfs') order by id`);
check('media', 'site-media is public and images only', bk.rows.find((b) => b.id === 'site-media')?.public === true && !bk.rows.find((b) => b.id === 'site-media').m.includes('pdf'));
check('media', 'rhapsody-pdfs is private and PDF only', bk.rows.find((b) => b.id === 'rhapsody-pdfs')?.public === false && bk.rows.find((b) => b.id === 'rhapsody-pdfs').m === 'application/pdf');

// =====================================================================================================================
// 7. Coordinators, private Hub data and audit integrity
// =====================================================================================================================
r = await as('authenticated', U.coord, `select web_save_draft('page','home','{"title":"Coordinator edit"}'::jsonb,1)`);
check('authority', 'coordinator cannot edit website content', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.coord, `select web_publish_content('page','home',1,'coordinator publish')`);
check('authority', 'coordinator cannot publish', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.coord, `select web_assign_role($1,$2,'Coordinator tries to assign a role')`, [U.member, ROLE.editor]);
check('authority', 'coordinator cannot assign website roles', refused(r), r.error || 'UNEXPECTED SUCCESS');
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
check('audit', 'role creation and assignment are audited', actions.includes('role.created') && actions.includes('assignment.created'), JSON.stringify(actions.slice(0, 6)));
check('audit', 'content publication is audited', actions.includes('content.published') && actions.includes('content.rolled_back'));
check('audit', 'post and event changes are audited', actions.includes('post.status_changed') && actions.includes('event.publication_changed'));
r = await owner(`update public.web_audit_log set action = 'tampered' where id = (select min(id) from public.web_audit_log)`).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('audit', 'audit rows cannot be updated, even by the owner', refused(r), r.error || 'UPDATED');
r = await owner(`delete from public.web_audit_log`).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('audit', 'audit rows cannot be deleted, even by the owner', refused(r), r.error || 'DELETED');
r = await as('authenticated', U.admin, `select web_revoke_assignment($1,'Editor role no longer needed')`, [editorAssignment]);
check('revocation', 'core administrator revokes an assignment with a reason', r.ok, r.error || '');
r = await as('authenticated', U.editor, `select web_save_draft('page','home','{"title":"After revoke"}'::jsonb,4)`);
check('revocation', 'revoked editor is refused on the next call', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_revoke_assignment($1,'x')`, [reviewerAssignment]);
check('revocation', 'revocation reason under 5 characters is refused', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_archive_role($1,'Role retired after the review year')`, [customRole]);
check('revocation', 'archiving a role revokes its assignments', r.ok, r.error || '');
r = await as('authenticated', U.reviewer, `select count(*)::int n from public.web_list_inquiries(null)`);
check('revocation', 'holder of an archived role loses access immediately', refused(r), r.error || 'UNEXPECTED SUCCESS');
r = await as('authenticated', U.admin, `select web_assign_role($1,$2,'Editor role returns for the new term')`, [U.editor, ROLE.editor]);
check('revocation', 'a revoked person can be assigned again (new assignment row)', r.ok, r.error || '');

// Hub regression: the Hub's own admin permission model is untouched by website roles.
const hubKeys = await owner(`select count(*)::int n from public.admin_role_permissions`);
check('hub', 'Hub admin_role_permissions table still exists and is unchanged by website roles', hubKeys.rows[0].n >= 0);
const hubCheck = await owner(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.admin_role_permissions'::regclass and conname = 'admin_role_permissions_permission_key_check'`);
check('hub', 'Hub permission key constraint still lists only the ten Hub keys', hubCheck.rows.length === 1 && !/website\./.test(hubCheck.rows[0].d) && (hubCheck.rows[0].d.match(/'[a-z]+\.[a-z_]+'/g) || []).length === 10, hubCheck.rows[0]?.d.slice(0, 120));

const failed = out.filter((x) => !x.ok);
console.log(`\nD2 DATABASE TESTS: ${out.length - failed.length}/${out.length} passed`);
if (failed.length) console.log('FAILED:\n' + failed.map((f) => `  [${f.area}] ${f.name}`).join('\n'));
process.exit(failed.length ? 1 : 0);
