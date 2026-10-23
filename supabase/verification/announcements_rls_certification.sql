-- announcements_rls_certification.sql
--
-- Certifies who may edit and delete announcements, and that a change touches only the row it names.
-- It runs the real RLS policies (announcements_manage, announcements_read) under SET ROLE, so the database
-- decides each result. Everything runs inside one transaction that is rolled back at the end.
--
-- Run against a database that has migrations 001-031 applied, with the Supabase roles (anon, authenticated,
-- service_role) and auth.uid() available. This script does not touch production data.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/verification/announcements_rls_certification.sql
--
-- A failed check raises "FAIL: <name>" and stops the run. Passing checks print "PASS: <name>".

\set ON_ERROR_STOP on
begin;

-- ── Fixtures (inserted as the owner, so RLS does not apply to the seed) ───────────────────────────────

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'coordinator@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'leader@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a4', 'leader-rejected@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a5', 'member@cert.invalid');

-- A trigger on auth.users may already have created these profiles, so set the fields the checks depend on.
insert into public.profiles (id, email, full_name, role, status) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@cert.invalid', 'Cert Admin', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000000a2', 'coordinator@cert.invalid', 'Cert Coordinator', 'coordinator', 'active'),
  ('00000000-0000-4000-8000-0000000000a3', 'leader@cert.invalid', 'Cert Leader', 'cell_leader', 'active'),
  ('00000000-0000-4000-8000-0000000000a4', 'leader-rejected@cert.invalid', 'Cert Rejected Leader', 'cell_leader', 'rejected'),
  ('00000000-0000-4000-8000-0000000000a5', 'member@cert.invalid', 'Cert Member', 'member', 'active')
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  status = excluded.status;

insert into public.announcements (id, title, body, author_id, author_name, created_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'Admin post', 'Body one', '00000000-0000-4000-8000-0000000000a1', 'Cert Admin', '2026-09-01T10:00:00Z'),
  ('00000000-0000-4000-8000-0000000000e2', 'Leader post', 'Body two', '00000000-0000-4000-8000-0000000000a3', 'Cert Leader', '2026-09-01T10:01:00Z'),
  ('00000000-0000-4000-8000-0000000000e3', 'Second admin post', 'Body three', '00000000-0000-4000-8000-0000000000a1', 'Cert Admin', '2026-09-01T10:02:00Z');

-- ── Helpers. Each switches to the given user with the Supabase JWT claim, runs one statement, and resets. ──

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create or replace function pg_temp.as_update_title(p_user uuid, p_id uuid, p_title text) returns integer
language plpgsql as $$
declare n integer;
begin
  perform pg_temp.act_as(p_user);
  update public.announcements set title = p_title where id = p_id;
  get diagnostics n = row_count;
  reset role;
  return n;
end $$;

create or replace function pg_temp.as_update_author(p_user uuid, p_id uuid, p_author uuid) returns integer
language plpgsql as $$
declare n integer;
begin
  perform pg_temp.act_as(p_user);
  update public.announcements set author_id = p_author where id = p_id;
  get diagnostics n = row_count;
  reset role;
  return n;
end $$;

create or replace function pg_temp.as_delete(p_user uuid, p_id uuid) returns integer
language plpgsql as $$
declare n integer;
begin
  perform pg_temp.act_as(p_user);
  delete from public.announcements where id = p_id;
  get diagnostics n = row_count;
  reset role;
  return n;
end $$;

create or replace function pg_temp.as_insert(p_user uuid) returns boolean
language plpgsql as $$
begin
  perform pg_temp.act_as(p_user);
  insert into public.announcements (title, body, author_id, author_name)
  values ('Inserted by test', 'x', p_user, 'Tester');
  reset role;
  return true;
exception when insufficient_privilege or others then
  reset role;
  return false;
end $$;

create or replace function pg_temp.as_visible_count(p_user uuid) returns integer
language plpgsql as $$
declare n integer;
begin
  perform pg_temp.act_as(p_user);
  select count(*) into n from public.announcements;
  reset role;
  return n;
end $$;

create or replace function pg_temp.as_anon_visible_count() returns integer
language plpgsql as $$
declare n integer;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) into n from public.announcements;
  reset role;
  return n;
exception when insufficient_privilege then
  reset role;
  return -1;
end $$;

create or replace function pg_temp.title_of(p_id uuid) returns text language sql as $$
  select title from public.announcements where id = p_id
$$;

create or replace function pg_temp.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  reset role;
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_name;
  end if;
  raise notice 'PASS: %', p_name;
end $$;

-- ── Users ─────────────────────────────────────────────────────────────────────────────────────────────

\set admin  '00000000-0000-4000-8000-0000000000a1'
\set coord  '00000000-0000-4000-8000-0000000000a2'
\set leader '00000000-0000-4000-8000-0000000000a3'
\set reject '00000000-0000-4000-8000-0000000000a4'
\set member '00000000-0000-4000-8000-0000000000a5'
\set e1 '00000000-0000-4000-8000-0000000000e1'
\set e2 '00000000-0000-4000-8000-0000000000e2'
\set e3 '00000000-0000-4000-8000-0000000000e3'
\set nowhere '00000000-0000-4000-8000-0000000000ff'

-- Read: members see announcements, so the list still works for them.
select pg_temp.check('member can read every announcement', pg_temp.as_visible_count(:'member'::uuid) = 3);
select pg_temp.check('anon cannot read announcements (no grant)', pg_temp.as_anon_visible_count() = -1);

-- Members cannot edit or delete, and their attempts change nothing.
select pg_temp.check('member update of another post affects 0 rows',
  pg_temp.as_update_title(:'member'::uuid, :'e1'::uuid, 'Hacked') = 0);
select pg_temp.check('member update left the title unchanged', pg_temp.title_of(:'e1'::uuid) = 'Admin post');
select pg_temp.check('member delete affects 0 rows',
  pg_temp.as_delete(:'member'::uuid, :'e1'::uuid) = 0);
select pg_temp.check('member cannot insert an announcement', pg_temp.as_insert(:'member'::uuid) = false);

-- A cell leader whose profile is not active is refused everywhere.
select pg_temp.check('rejected cell leader update affects 0 rows',
  pg_temp.as_update_title(:'reject'::uuid, :'e1'::uuid, 'Hacked') = 0);
select pg_temp.check('rejected cell leader delete affects 0 rows',
  pg_temp.as_delete(:'reject'::uuid, :'e1'::uuid) = 0);
select pg_temp.check('rejected cell leader cannot insert', pg_temp.as_insert(:'reject'::uuid) = false);

-- Admin and coordinator may edit, and an update changes exactly one row.
select pg_temp.check('admin updates one post and reports 1 row',
  pg_temp.as_update_title(:'admin'::uuid, :'e1'::uuid, 'Admin post (edited)') = 1);
select pg_temp.check('admin edit did not change the other posts',
  pg_temp.title_of(:'e2'::uuid) = 'Leader post' and pg_temp.title_of(:'e3'::uuid) = 'Second admin post');
select pg_temp.check('coordinator updates a post and reports 1 row',
  pg_temp.as_update_title(:'coord'::uuid, :'e2'::uuid, 'Leader post (edited)') = 1);
select pg_temp.check('coordinator edit did not change the other posts',
  pg_temp.title_of(:'e1'::uuid) = 'Admin post (edited)' and pg_temp.title_of(:'e3'::uuid) = 'Second admin post');

-- Active cell leaders may edit (current policy: any active cell leader, not only their own posts).
select pg_temp.check('active cell leader updates a post and reports 1 row',
  pg_temp.as_update_title(:'leader'::uuid, :'e3'::uuid, 'Second admin post (edited)') = 1);

-- Changing the author through an update is not allowed to a non-managing caller, and a missing id matches nothing.
select pg_temp.check('member cannot reassign an author', pg_temp.as_update_author(:'member'::uuid, :'e1'::uuid, :'member'::uuid) = 0);
select pg_temp.check('update of a missing id affects 0 rows',
  pg_temp.as_update_title(:'admin'::uuid, :'nowhere'::uuid, 'x') = 0);

-- Delete removes only the named row.
select pg_temp.check('admin deletes one post and reports 1 row',
  pg_temp.as_delete(:'admin'::uuid, :'e3'::uuid) = 1);
select pg_temp.check('delete removed only the selected post',
  pg_temp.as_visible_count(:'admin'::uuid) = 2
  and pg_temp.title_of(:'e1'::uuid) = 'Admin post (edited)'
  and pg_temp.title_of(:'e2'::uuid) = 'Leader post (edited)');

-- Managing users can insert, so the composer keeps working.
select pg_temp.check('coordinator can insert an announcement', pg_temp.as_insert(:'coord'::uuid) = true);
select pg_temp.check('active cell leader can insert an announcement', pg_temp.as_insert(:'leader'::uuid) = true);

select 'ALL ANNOUNCEMENT RLS CHECKS PASSED' as result;

rollback;
