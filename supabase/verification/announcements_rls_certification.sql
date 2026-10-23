-- announcements_rls_certification.sql
--
-- Certifies who may create, view, edit and delete announcements, and that a change touches only the row it names.
-- It runs the real RLS policies (announcements_read, announcements_insert, announcements_update, announcements_delete)
-- under SET ROLE, so the database decides each result. Everything runs inside one transaction that is rolled back.
--
-- Rules certified (migration 043 on top of 031 and 024):
--   admin, coordinator          create; edit and delete any announcement
--   cell_leader (active)        create; edit and delete only announcements where author_id = auth.uid()
--   member (active)             view only
--   pending, rejected, inactive view nothing and manage nothing
--   author_id is never a grant: a post is attributed to the caller or refused, and no one can take ownership of
--   another person's post.
--
-- Run against a database that has migrations 001-043 applied, with the Supabase roles (anon, authenticated,
-- service_role) and auth.uid() available. It does not touch production data.
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
  ('00000000-0000-4000-8000-0000000000a5', 'member@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a6', 'leader-pending@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a7', 'admin-inactive@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a8', 'member-pending@cert.invalid');

-- A trigger on auth.users may already have created these profiles, so set the fields the checks depend on.
insert into public.profiles (id, email, full_name, role, status) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@cert.invalid', 'Cert Admin', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000000a2', 'coordinator@cert.invalid', 'Cert Coordinator', 'coordinator', 'active'),
  ('00000000-0000-4000-8000-0000000000a3', 'leader@cert.invalid', 'Cert Leader', 'cell_leader', 'active'),
  ('00000000-0000-4000-8000-0000000000a4', 'leader-rejected@cert.invalid', 'Cert Rejected Leader', 'cell_leader', 'rejected'),
  ('00000000-0000-4000-8000-0000000000a5', 'member@cert.invalid', 'Cert Member', 'member', 'active'),
  ('00000000-0000-4000-8000-0000000000a6', 'leader-pending@cert.invalid', 'Cert Pending Leader', 'cell_leader', 'pending'),
  ('00000000-0000-4000-8000-0000000000a7', 'admin-inactive@cert.invalid', 'Cert Inactive Admin', 'admin', 'inactive'),
  ('00000000-0000-4000-8000-0000000000a8', 'member-pending@cert.invalid', 'Cert Pending Member', 'member', 'pending')
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  status = excluded.status;

-- Posts: e1 admin, e2 active leader, e3 admin, e4 rejected leader, e5 member.
insert into public.announcements (id, title, body, author_id, author_name, created_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'Admin post', 'Body one', '00000000-0000-4000-8000-0000000000a1', 'Cert Admin', '2026-09-01T10:00:00Z'),
  ('00000000-0000-4000-8000-0000000000e2', 'Leader post', 'Body two', '00000000-0000-4000-8000-0000000000a3', 'Cert Leader', '2026-09-01T10:01:00Z'),
  ('00000000-0000-4000-8000-0000000000e3', 'Second admin post', 'Body three', '00000000-0000-4000-8000-0000000000a1', 'Cert Admin', '2026-09-01T10:02:00Z'),
  ('00000000-0000-4000-8000-0000000000e4', 'Rejected leader post', 'Body four', '00000000-0000-4000-8000-0000000000a4', 'Cert Rejected Leader', '2026-09-01T10:03:00Z'),
  ('00000000-0000-4000-8000-0000000000e5', 'Member note', 'Body five', '00000000-0000-4000-8000-0000000000a5', 'Cert Member', '2026-09-01T10:04:00Z');

-- ── Helpers. Each switches to the given user with the Supabase JWT claim, runs one statement, then resets. ──
-- A refusal is reported as 0 rows (USING filtered it) or -1 (WITH CHECK raised an error).

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
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

create or replace function pg_temp.as_insert(p_user uuid, p_author uuid) returns boolean
language plpgsql as $$
begin
  perform pg_temp.act_as(p_user);
  insert into public.announcements (title, body, author_id, author_name)
  values ('Inserted by test', 'x', p_author, 'Tester');
  reset role;
  return true;
exception when insufficient_privilege or others then
  reset role;
  return false;
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
exception when insufficient_privilege or others then
  reset role;
  return -1;
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
exception when insufficient_privilege or others then
  reset role;
  return -1;
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
exception when insufficient_privilege or others then
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

-- ── Identities and rows ────────────────────────────────────────────────────────────────────────────────

\set admin    '00000000-0000-4000-8000-0000000000a1'
\set coord    '00000000-0000-4000-8000-0000000000a2'
\set leader   '00000000-0000-4000-8000-0000000000a3'
\set rejected '00000000-0000-4000-8000-0000000000a4'
\set member   '00000000-0000-4000-8000-0000000000a5'
\set pending  '00000000-0000-4000-8000-0000000000a6'
\set inactive '00000000-0000-4000-8000-0000000000a7'
\set mpending '00000000-0000-4000-8000-0000000000a8'
\set e1 '00000000-0000-4000-8000-0000000000e1'
\set e2 '00000000-0000-4000-8000-0000000000e2'
\set e3 '00000000-0000-4000-8000-0000000000e3'
\set e4 '00000000-0000-4000-8000-0000000000e4'
\set e5 '00000000-0000-4000-8000-0000000000e5'
\set nowhere '00000000-0000-4000-8000-0000000000ff'

-- ── Viewing ────────────────────────────────────────────────────────────────────────────────────────────

select pg_temp.check('active member can view every announcement', pg_temp.as_visible_count(:'member'::uuid) = 5);
select pg_temp.check('anon cannot view announcements (no grant)', pg_temp.as_anon_visible_count() = -1);
select pg_temp.check('pending member views nothing', pg_temp.as_visible_count(:'mpending'::uuid) = 0);
select pg_temp.check('pending cell leader views nothing', pg_temp.as_visible_count(:'pending'::uuid) = 0);
select pg_temp.check('rejected cell leader views nothing', pg_temp.as_visible_count(:'rejected'::uuid) = 0);
select pg_temp.check('inactive admin views nothing', pg_temp.as_visible_count(:'inactive'::uuid) = 0);

-- ── Creating ───────────────────────────────────────────────────────────────────────────────────────────

select pg_temp.check('admin can create under their own id', pg_temp.as_insert(:'admin'::uuid, :'admin'::uuid));
select pg_temp.check('coordinator can create under their own id', pg_temp.as_insert(:'coord'::uuid, :'coord'::uuid));
select pg_temp.check('active cell leader can create under their own id', pg_temp.as_insert(:'leader'::uuid, :'leader'::uuid));
select pg_temp.check('active cell leader cannot create under another author id', pg_temp.as_insert(:'leader'::uuid, :'admin'::uuid) = false);
select pg_temp.check('member cannot create', pg_temp.as_insert(:'member'::uuid, :'member'::uuid) = false);
select pg_temp.check('pending cell leader cannot create', pg_temp.as_insert(:'pending'::uuid, :'pending'::uuid) = false);
select pg_temp.check('rejected cell leader cannot create', pg_temp.as_insert(:'rejected'::uuid, :'rejected'::uuid) = false);
select pg_temp.check('inactive admin cannot create', pg_temp.as_insert(:'inactive'::uuid, :'inactive'::uuid) = false);

-- ── Editing: refusals change nothing ───────────────────────────────────────────────────────────────────

select pg_temp.check('member cannot edit an admin post', pg_temp.as_update_title(:'member'::uuid, :'e1'::uuid, 'Hacked') = 0);
select pg_temp.check('member cannot edit their own post', pg_temp.as_update_title(:'member'::uuid, :'e5'::uuid, 'Hacked') = 0);
select pg_temp.check('pending cell leader cannot edit an admin post', pg_temp.as_update_title(:'pending'::uuid, :'e1'::uuid, 'Hacked') = 0);
select pg_temp.check('rejected cell leader cannot edit their own post', pg_temp.as_update_title(:'rejected'::uuid, :'e4'::uuid, 'Hacked') = 0);
select pg_temp.check('inactive admin cannot edit an admin post', pg_temp.as_update_title(:'inactive'::uuid, :'e1'::uuid, 'Hacked') = 0);
select pg_temp.check('refused edits left every title unchanged',
  pg_temp.title_of(:'e1'::uuid) = 'Admin post'
  and pg_temp.title_of(:'e4'::uuid) = 'Rejected leader post'
  and pg_temp.title_of(:'e5'::uuid) = 'Member note');

-- ── Editing: authorized, and each change touches one row ───────────────────────────────────────────────

select pg_temp.check('admin edits an admin post and reports 1 row',
  pg_temp.as_update_title(:'admin'::uuid, :'e1'::uuid, 'Admin post (edited)') = 1);
select pg_temp.check('admin edit changed no other row',
  pg_temp.title_of(:'e2'::uuid) = 'Leader post' and pg_temp.title_of(:'e3'::uuid) = 'Second admin post'
  and pg_temp.title_of(:'e4'::uuid) = 'Rejected leader post' and pg_temp.title_of(:'e5'::uuid) = 'Member note');
select pg_temp.check('coordinator edits an admin post and reports 1 row',
  pg_temp.as_update_title(:'coord'::uuid, :'e3'::uuid, 'Second admin post (edited)') = 1);
select pg_temp.check('coordinator edit changed no other row',
  pg_temp.title_of(:'e1'::uuid) = 'Admin post (edited)' and pg_temp.title_of(:'e2'::uuid) = 'Leader post');
select pg_temp.check('active cell leader edits their own post and reports 1 row',
  pg_temp.as_update_title(:'leader'::uuid, :'e2'::uuid, 'Leader post (edited)') = 1);
select pg_temp.check('active cell leader cannot edit another author post',
  pg_temp.as_update_title(:'leader'::uuid, :'e1'::uuid, 'Hacked') = 0);
select pg_temp.check('cell leader edit of own post changed no other row',
  pg_temp.title_of(:'e1'::uuid) = 'Admin post (edited)' and pg_temp.title_of(:'e3'::uuid) = 'Second admin post (edited)');

-- ── Ownership: no one can take a post that is not theirs ──────────────────────────────────────────────

select pg_temp.check('active cell leader cannot hand their post to another author',
  pg_temp.as_update_author(:'leader'::uuid, :'e2'::uuid, :'admin'::uuid) in (-1, 0));
select pg_temp.check('active cell leader cannot take an admin post by reassigning it',
  pg_temp.as_update_author(:'leader'::uuid, :'e1'::uuid, :'leader'::uuid) = 0);
select pg_temp.check('member cannot reassign an author', pg_temp.as_update_author(:'member'::uuid, :'e1'::uuid, :'member'::uuid) = 0);
select pg_temp.check('a refused reassignment left the author unchanged',
  (select author_id from public.announcements where id = :'e2'::uuid) = :'leader'::uuid
  and (select author_id from public.announcements where id = :'e1'::uuid) = :'admin'::uuid);
select pg_temp.check('update of a missing id affects 0 rows',
  pg_temp.as_update_title(:'admin'::uuid, :'nowhere'::uuid, 'x') = 0);

-- ── Deleting ───────────────────────────────────────────────────────────────────────────────────────────

select pg_temp.check('member cannot delete an admin post', pg_temp.as_delete(:'member'::uuid, :'e1'::uuid) = 0);
select pg_temp.check('pending cell leader cannot delete an admin post', pg_temp.as_delete(:'pending'::uuid, :'e1'::uuid) = 0);
select pg_temp.check('rejected cell leader cannot delete their own post', pg_temp.as_delete(:'rejected'::uuid, :'e4'::uuid) = 0);
select pg_temp.check('inactive admin cannot delete an admin post', pg_temp.as_delete(:'inactive'::uuid, :'e1'::uuid) = 0);
select pg_temp.check('active cell leader cannot delete another author post', pg_temp.as_delete(:'leader'::uuid, :'e1'::uuid) = 0);
-- Five seeded posts plus the three created above.
select pg_temp.check('refused deletes removed nothing', pg_temp.as_visible_count(:'admin'::uuid) = 8);

select pg_temp.check('active cell leader deletes their own post and reports 1 row',
  pg_temp.as_delete(:'leader'::uuid, :'e2'::uuid) = 1);
select pg_temp.check('admin deletes a post and reports 1 row', pg_temp.as_delete(:'admin'::uuid, :'e3'::uuid) = 1);
select pg_temp.check('deletes removed only the selected posts',
  pg_temp.as_visible_count(:'admin'::uuid) = 6
  and pg_temp.title_of(:'e1'::uuid) = 'Admin post (edited)'
  and pg_temp.title_of(:'e4'::uuid) = 'Rejected leader post');

select 'ALL ANNOUNCEMENT RLS CHECKS PASSED' as result;

rollback;
