import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const HERE = new URL('.', import.meta.url).pathname;
const fn = () => fs.readFileSync(HERE + 'production_is_cell_leader_for_profile.catalog.sql', 'utf8');
const viewSql = fs.readFileSync(HERE + 'production_member_directory.catalog.sql', 'utf8');
const MODE = process.env.MODE || 'current';   // current | v2 | rollback
const db = new PGlite();
await db.exec(`
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role authenticated nologin; create role anon nologin;
create table bscs (id uuid primary key, name text);
create table cells (id uuid primary key, name text, leader_id uuid);
create table profiles (id uuid primary key, role text not null, status text not null, cell_id uuid, bsc_id uuid references bscs(id), full_name text, email text, student_number text, avatar_url text, joined_at timestamptz default now());
create table user_profiles (user_id uuid primary key references profiles(id), phone text, bio text, first_name text, last_name text, student_number text);
create table prayer_requests (id uuid primary key, author_id uuid references profiles(id), visibility text, is_anonymous boolean, is_active boolean default true, author_name text, content text);
create function is_admin_or_coordinator() returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active' and role in ('admin','coordinator')) $$;
`);
await db.exec(fn());
await db.exec(viewSql);
await db.exec(`
alter table profiles enable row level security; alter table user_profiles enable row level security; alter table prayer_requests enable row level security;
create policy profiles_select_scoped on profiles for select to public using ((id = auth.uid()) OR is_admin_or_coordinator() OR is_cell_leader_for_profile(id));
create policy user_profiles_select_scoped on user_profiles for select to public using ((user_id = auth.uid()) OR is_admin_or_coordinator() OR is_cell_leader_for_profile(user_id));
create policy prayers_leadership_read on prayer_requests for select to public using ((visibility = ANY (ARRAY['leadership'::text, 'shared'::text])) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['coordinator'::text, 'admin'::text, 'cell_leader'::text]))))));
grant select on profiles, user_profiles, prayer_requests, member_directory, cells, bscs to authenticated; grant usage on schema auth to authenticated; grant execute on all functions in schema public to authenticated;
insert into bscs values ('00000000-0000-0000-0000-0000000000b5','BSC 1');
insert into cells values
 ('00000000-0000-0000-0000-0000000000c1','Cell A','00000000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000000c2','Cell B','00000000-0000-0000-0000-0000000000a2'),
 ('00000000-0000-0000-0000-0000000000c3','Cell C','00000000-0000-0000-0000-0000000000a3');
insert into profiles values
 ('00000000-0000-0000-0000-0000000000a1','cell_leader','active','00000000-0000-0000-0000-0000000000c1',null,'Assigned Leader A (role cell_leader)','la@x.test','SL-A',null,now()),
 ('00000000-0000-0000-0000-0000000000a3','member','active','00000000-0000-0000-0000-0000000000c3',null,'Assigned Leader C (member role)','lc@x.test','SL-C',null,now()),
 ('00000000-0000-0000-0000-0000000000a4','cell_leader','active','00000000-0000-0000-0000-0000000000c1',null,'Role-only Leader (no assignment)','ro@x.test','SL-R',null,now()),
 ('00000000-0000-0000-0000-0000000000a2','cell_leader','active','00000000-0000-0000-0000-0000000000c2',null,'Assigned Leader B','lb@x.test','SL-B',null,now()),
 ('00000000-0000-0000-0000-0000000000b1','member','active','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b5','Member A1','ma1@x.test','S-A1',null,now()),
 ('00000000-0000-0000-0000-0000000000b2','member','active','00000000-0000-0000-0000-0000000000c1',null,'Member A2','ma2@x.test','S-A2',null,now()),
 ('00000000-0000-0000-0000-0000000000b3','member','pending','00000000-0000-0000-0000-0000000000c1',null,'Pending Applicant','pa@x.test','S-P',null,now()),
 ('00000000-0000-0000-0000-0000000000b4','member','active','00000000-0000-0000-0000-0000000000c2',null,'Member B1','mb1@x.test','S-B1',null,now()),
 ('00000000-0000-0000-0000-0000000000ad','admin','active',null,null,'Admin','ad@x.test','S-AD',null,now()),
 ('00000000-0000-0000-0000-0000000000e1','member','active','00000000-0000-0000-0000-0000000000c1',null,'Ordinary Member','om@x.test','S-OM',null,now()),
 ('00000000-0000-0000-0000-0000000000e2','member','active','00000000-0000-0000-0000-0000000000c3',null,'Member of Cell C','mc@x.test','S-C1',null,now());
insert into user_profiles values
 ('00000000-0000-0000-0000-0000000000b1','416-555-0101','Bio A1','Member','A1',''),
 ('00000000-0000-0000-0000-0000000000b4','416-555-0102','Bio B1','Member','B1',''),
 ('00000000-0000-0000-0000-0000000000b3','416-555-0199','Bio P','Pending','P','');
insert into prayer_requests values
 ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000000b1','leadership',false,true,'Member A1','named leadership prayer, cell A'),
 ('00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-0000000000b1','leadership',true,true,'Member A1','ANONYMOUS leadership prayer, cell A'),
 ('00000000-0000-0000-0000-000000000703','00000000-0000-0000-0000-0000000000b4','leadership',false,true,'Member B1','leadership prayer, cell B'),
 ('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-0000000000b1','shared',false,true,'Member A1','shared prayer'),
 ('00000000-0000-0000-0000-000000000705','00000000-0000-0000-0000-0000000000b2','shared',true,true,'Member A2','ANONYMOUS shared prayer');
`);
if (MODE === 'v2') {
  await db.exec(fs.readFileSync(HERE + 'production_profile_v2_helper.sql', 'utf8'));
  await db.exec(fs.readFileSync(HERE + 'production_prayer_v2.sql', 'utf8'));
}
async function as(uid, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return (await db.query(sql)).rows; } catch (e) { return 'ERROR ' + e.message.slice(0, 80); } finally { await db.exec('reset role;'); }
}
const id = (n) => `00000000-0000-0000-0000-${n}`;
const U = { assignedA: id('0000000000a1'), assignedC_memberRole: id('0000000000a3'), roleOnly: id('0000000000a4'), assignedB: id('0000000000a2'), admin: id('0000000000ad'), memberA1: id('0000000000b1'), ordinary: id('0000000000e1') };
const T = { memberA1: id('0000000000b1'), memberA2: id('0000000000b2'), memberB1: id('0000000000b4'), pending: id('0000000000b3') };
const probes = {
  // Legacy app read shapes (Members list, Cells roster, PersonDetailPanel phone)
  assignedA_directory_cell_members: () => as(U.assignedA, `select id, full_name, cell_id, role, status from member_directory where cell_id='${id('0000000000c1')}' order by full_name`),
  assignedA_profiles_by_cell: () => as(U.assignedA, `select id from profiles where cell_id='${id('0000000000c1')}'`),
  assignedA_userprofile_phone_memberA1: () => as(U.assignedA, `select phone from user_profiles where user_id='${T.memberA1}'`),
  assignedC_memberRole_directory_cellC: () => as(U.assignedC_memberRole, `select id from member_directory where cell_id='${id('0000000000c3')}'`),
  assignedC_memberRole_reads_cellA_member: () => as(U.assignedC_memberRole, `select id from profiles where id='${T.memberA1}'`),
  roleOnly_directory_cell_members: () => as(U.roleOnly, `select id from member_directory where cell_id='${id('0000000000c1')}'`),
  roleOnly_profile_memberA1: () => as(U.roleOnly, `select id from profiles where id='${T.memberA1}'`),
  roleOnly_userprofile_memberA1: () => as(U.roleOnly, `select user_id from user_profiles where user_id='${T.memberA1}'`),
  roleOnly_pending_profile: () => as(U.roleOnly, `select id from profiles where id='${T.pending}'`),
  assignedA_pending_profile: () => as(U.assignedA, `select id from profiles where id='${T.pending}'`),
  assignedA_cross_cell_memberB1: () => as(U.assignedA, `select id from profiles where id='${T.memberB1}'`),
  assignedB_memberA1: () => as(U.assignedB, `select id from profiles where id='${T.memberA1}'`),
  ordinary_memberA2: () => as(U.ordinary, `select id from profiles where id='${T.memberA2}'`),
  memberA1_self: () => as(U.memberA1, `select id from profiles where id='${U.memberA1}'`),
  admin_pending_profile: () => as(U.admin, `select id from profiles where id='${T.pending}'`),
  assignedA_student_number_memberA1_RESIDUAL: () => as(U.assignedA, `select student_number from profiles where id='${T.memberA1}'`),
  assignedA_userprofile_student_number_RESIDUAL: () => as(U.assignedA, `select student_number from user_profiles where user_id='${T.memberA1}'`),
  admin_all_profiles: () => as(U.admin, `select id from profiles`),
  // Prayers
  assignedA_prayers: () => as(U.assignedA, `select id, is_anonymous from prayer_requests order by id`),
  roleOnly_prayers: () => as(U.roleOnly, `select id, is_anonymous from prayer_requests order by id`),
  assignedB_prayers: () => as(U.assignedB, `select id, is_anonymous from prayer_requests order by id`),
  admin_prayers: () => as(U.admin, `select id from prayer_requests order by id`),
  memberA1_prayers: () => as(U.memberA1, `select id from prayer_requests order by id`),
};
const out = {};
for (const k of Object.keys(probes)) { const r = await probes[k](); out[k] = Array.isArray(r) ? (r.length + (r.length ? ' ' + JSON.stringify(r.map(x => Object.values(x)[0].slice(-3))) : '')) : r; }
console.log(MODE, '\n' + JSON.stringify(out, null, 1));
await db.close();
