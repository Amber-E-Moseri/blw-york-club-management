import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(`
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role authenticated nologin;
create table profiles (id uuid primary key, role text not null, status text not null, cell_id uuid);
create table prayer_requests (id uuid primary key, author_id uuid references profiles(id), visibility text, is_anonymous boolean, is_active boolean default true, author_name text, content text);
create function is_admin_or_coordinator() returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active' and role in ('admin','coordinator')) $$;
insert into profiles values
 ('00000000-0000-0000-0000-00000000000a','cell_leader','active','00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-00000000000b','member','active','00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-00000000000e','member','active','00000000-0000-0000-0000-0000000000c2'),
 ('00000000-0000-0000-0000-0000000000ad','admin','active',null);
insert into prayer_requests values
 ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-00000000000b','leadership',false,true,'Member A','named leadership prayer, cell A'),
 ('00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-00000000000b','leadership',true,true,'Member A','ANONYMOUS leadership prayer, cell A'),
 ('00000000-0000-0000-0000-000000000703','00000000-0000-0000-0000-00000000000e','leadership',false,true,'Member B','leadership prayer, cell B'),
 ('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-00000000000b','shared',false,true,'Member A','shared prayer');
alter table prayer_requests enable row level security;
create policy prayers_leadership_read on prayer_requests for select to public using ((visibility = ANY (ARRAY['leadership'::text, 'shared'::text])) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['coordinator'::text, 'admin'::text, 'cell_leader'::text]))))));
grant select on prayer_requests, profiles to authenticated; grant usage on schema auth to authenticated; grant execute on all functions in schema public to authenticated;`);
async function as(uid, sql) { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`); try { return (await db.query(sql)).rows; } catch (e) { return 'ERROR ' + e.message; } finally { await db.exec('reset role;'); } }
const L='00000000-0000-0000-0000-00000000000a', AD='00000000-0000-0000-0000-0000000000ad';
const show = async (label) => { const rows = await as(L, `select id, author_id, is_anonymous from prayer_requests`); console.log(label, 'role-only leader sees', Array.isArray(rows) ? rows.map(r => r.id.slice(-3) + (r.is_anonymous ? '(anon, author_id exposed)' : '')).join(', ') : rows); };
await show('BEFORE:');
// PROPOSED MITIGATION (not executed): drop the role-based leadership read; keep staff read through the same visibility.
await db.exec(`drop policy prayers_leadership_read on prayer_requests; create policy prayers_leadership_staff on prayer_requests for select to public using ((visibility = ANY (ARRAY['leadership'::text,'shared'::text])) AND is_admin_or_coordinator());`);
await show('AFTER mitigation:');
console.log('admin sees', (await as(AD, `select id from prayer_requests`)).length, 'of 4');
await db.exec(`drop policy prayers_leadership_staff on prayer_requests; create policy prayers_leadership_read on prayer_requests for select to public using ((visibility = ANY (ARRAY['leadership'::text, 'shared'::text])) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['coordinator'::text, 'admin'::text, 'cell_leader'::text]))))));`);
await show('ROLLED BACK:');
await db.close();
