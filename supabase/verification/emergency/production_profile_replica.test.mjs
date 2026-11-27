import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const S = process.env.S;
const db = new PGlite();
await db.exec(`
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role authenticated nologin; create role anon nologin;
create table profiles (id uuid primary key, role text not null, status text not null, cell_id uuid, full_name text, email text, student_number text);
create table user_profiles (user_id uuid primary key references profiles(id), phone text, bio text, first_name text, last_name text, student_number text);
create function is_admin_or_coordinator() returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active' and role in ('admin','coordinator')) $$;
`);
await db.exec(fs.readFileSync(S + '/production_is_cell_leader_for_profile.catalog.sql', 'utf8'));
await db.exec(`alter table profiles enable row level security; alter table user_profiles enable row level security;
create policy profiles_select_scoped on profiles for select to public using ((id = auth.uid()) OR is_admin_or_coordinator() OR is_cell_leader_for_profile(id));
create policy user_profiles_select_scoped on user_profiles for select to public using ((user_id = auth.uid()) OR is_admin_or_coordinator() OR is_cell_leader_for_profile(user_id));
grant select on profiles, user_profiles to authenticated; grant usage on schema auth to authenticated; grant execute on all functions in schema public to authenticated;
insert into profiles values
 ('00000000-0000-0000-0000-00000000000a','cell_leader','active','00000000-0000-0000-0000-0000000000c1','Role-only Leader','rl@x.test','SL'),
 ('00000000-0000-0000-0000-00000000000b','member','active','00000000-0000-0000-0000-0000000000c1','Member A','ma@x.test','S-A'),
 ('00000000-0000-0000-0000-00000000000d','member','pending','00000000-0000-0000-0000-0000000000c1','Pending Applicant','pa@x.test','S-P'),
 ('00000000-0000-0000-0000-00000000000e','member','active','00000000-0000-0000-0000-0000000000c2','Member B','mb@x.test','S-B'),
 ('00000000-0000-0000-0000-0000000000ad','admin','active',null,'Admin','ad@x.test','S-AD');
insert into user_profiles values ('00000000-0000-0000-0000-00000000000b','416-555-0101','Bio A','Member','A',''), ('00000000-0000-0000-0000-00000000000e','416-555-0102','Bio B','Member','B','');`);
const L='00000000-0000-0000-0000-00000000000a', A='00000000-0000-0000-0000-00000000000b', P='00000000-0000-0000-0000-00000000000d', M='00000000-0000-0000-0000-00000000000b', AD='00000000-0000-0000-0000-0000000000ad';
async function as(uid, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return (await db.query(sql)).rows; } catch (e) { return 'ERROR ' + e.message; } finally { await db.exec('reset role;'); }
}
const probes = () => ({
  roleOnlyLeader_profile_memberA: () => as(L, `select 1 from profiles where id='${A}'`),
  roleOnlyLeader_userprofile_memberA: () => as(L, `select 1 from user_profiles where user_id='${A}'`),
  roleOnlyLeader_pending: () => as(L, `select 1 from profiles where id='${P}'`),
  roleOnlyLeader_self: () => as(L, `select 1 from profiles where id='${L}'`),
  memberA_self: () => as(M, `select 1 from profiles where id='${M}'`),
  memberA_userprofile_self: () => as(M, `select 1 from user_profiles where user_id='${M}'`),
  admin_reads_memberA: () => as(AD, `select 1 from profiles where id='${A}'`),
  admin_reads_pending: () => as(AD, `select 1 from profiles where id='${P}'`),
});
const count = (r) => Array.isArray(r) ? r.length : r;
const runAll = async () => { const out = {}; const p = probes(); for (const k of Object.keys(p)) out[k] = count(await p[k]()); return out; };
const before = await runAll();
await db.exec(fs.readFileSync(S + "/production_profile_mitigation.sql", "utf8")); console.log("POLICIES AFTER MIGRATION:", JSON.stringify((await db.query("select policyname, qual from pg_policies where tablename='profiles'")).rows));
const after = await runAll();
await db.exec(fs.readFileSync(S + '/production_profile_rollback.sql', 'utf8'));
const rolledBack = await runAll();
console.log(JSON.stringify({ before, after, rolledBack }, null, 1));
