-- announcements_port_rls_certification.sql
--
-- Certifies announcement viewing, creation, editing and deletion on the authoritative migration history (000-103,
-- with 105 applied), using the real policies under SET ROLE. Everything runs in one transaction that is rolled back.
--
-- Rules certified (064, 075, 082 and 105):
--   admin, coordinator (active)  view all active posts; create broadcasts or targeted posts; edit and delete any post
--   cell_leader (active)         view what the audience allows; create targeted posts for a cell they lead only;
--                                edit and delete only their own targeted posts; never broadcasts
--   member (active)              view posts that reach them; no create, edit or delete
--   pending, rejected, inactive  view nothing; no create, edit or delete
--   The audience of published content never changes (trigger 105, which also fixes the update failure).
--
-- Apply migrations 000-105 first.
--   psql -v ON_ERROR_STOP=1 -f supabase/verification/announcements_port_rls_certification.sql

\set ON_ERROR_STOP on
begin;

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create or replace function pg_temp.as_visible_count(p_user uuid) returns integer language plpgsql as $$
declare n integer;
begin
  perform pg_temp.act_as(p_user);
  select count(*) into n from public.announcements;
  reset role;
  return n;
end $$;

create or replace function pg_temp.as_insert(p_user uuid, p_author uuid, p_spec uuid) returns boolean
language plpgsql as $$
begin
  perform pg_temp.act_as(p_user);
  insert into public.announcements (title, body, author_id, author_name, audience_spec_id)
  values ('Inserted by test', 'x', p_author, 'Tester', p_spec);
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

create or replace function pg_temp.as_update_spec(p_user uuid, p_id uuid, p_spec uuid) returns integer
language plpgsql as $$
declare n integer;
begin
  perform pg_temp.act_as(p_user);
  update public.announcements set audience_spec_id = p_spec where id = p_id;
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

create or replace function pg_temp.spec_of(p_id uuid) returns uuid language sql as $$
  select audience_spec_id from public.announcements where id = p_id
$$;

create or replace function pg_temp.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  reset role;
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_name;
  end if;
  raise notice 'PASS: %', p_name;
end $$;

-- ── Identities ───────────────────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'p-admin@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'p-coord@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'p-leader@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a4', 'p-leader2@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a5', 'p-member@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a6', 'p-pending@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a7', 'p-inactive@cert.invalid'),
  ('00000000-0000-4000-8000-0000000000a8', 'p-rejected@cert.invalid')
on conflict do nothing;

insert into public.profiles (id, email, full_name, role, status) values
  ('00000000-0000-4000-8000-0000000000a1', 'p-admin@cert.invalid', 'P Admin', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000000a2', 'p-coord@cert.invalid', 'P Coordinator', 'coordinator', 'active'),
  ('00000000-0000-4000-8000-0000000000a3', 'p-leader@cert.invalid', 'P Leader', 'cell_leader', 'active'),
  ('00000000-0000-4000-8000-0000000000a4', 'p-leader2@cert.invalid', 'P Leader Two', 'cell_leader', 'active'),
  ('00000000-0000-4000-8000-0000000000a5', 'p-member@cert.invalid', 'P Member', 'member', 'active'),
  ('00000000-0000-4000-8000-0000000000a6', 'p-pending@cert.invalid', 'P Pending', 'cell_leader', 'pending'),
  ('00000000-0000-4000-8000-0000000000a7', 'p-inactive@cert.invalid', 'P Inactive', 'admin', 'inactive'),
  ('00000000-0000-4000-8000-0000000000a8', 'p-rejected@cert.invalid', 'P Rejected', 'cell_leader', 'rejected')
on conflict (id) do update set role = excluded.role, status = excluded.status, full_name = excluded.full_name;

-- Cells: c1 led by leader a3, c2 led by leader a4. The member a5 belongs to cell one; member a9 to cell two.
-- Each targeted spec needs at least one active member in its cell, or the snapshot refuses the post.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a9', 'p-member2@cert.invalid')
  on conflict do nothing;
-- Cell assignments need a recorded reason (093). This is fixture seeding, so the reason is set for this transaction.
select set_config('app.cell_change_reason', 'port certification fixture', true);
insert into public.profiles (id, email, full_name, role, status, cell_id) values
  ('00000000-0000-4000-8000-0000000000a9', 'p-member2@cert.invalid', 'P Member Two', 'member', 'active', '00000000-0000-4000-8000-0000000000c2')
on conflict (id) do update set role = excluded.role, status = excluded.status, cell_id = excluded.cell_id;
insert into public.cells (id, name, leader_id) values
  ('00000000-0000-4000-8000-0000000000c1', 'Cell One', '00000000-0000-4000-8000-0000000000a3'),
  ('00000000-0000-4000-8000-0000000000c2', 'Cell Two', '00000000-0000-4000-8000-0000000000a4');
select set_config('app.cell_change_reason', 'port certification fixture', true);
update public.profiles set cell_id = '00000000-0000-4000-8000-0000000000c1' where id = '00000000-0000-4000-8000-0000000000a5';

-- Specs: s1 targets cell one only, s2 targets cell two only.
insert into public.audience_specs (id, mode, cell_ids, created_by) values
  ('00000000-0000-4000-8000-0000000000f1', 'cells', array['00000000-0000-4000-8000-0000000000c1']::uuid[], '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000f2', 'cells', array['00000000-0000-4000-8000-0000000000c2']::uuid[], '00000000-0000-4000-8000-0000000000a1');

-- Posts: e1 admin broadcast, e2 admin to cell one, e3 leader a3 to cell one, e4 leader a4 to cell two,
-- e5 rejected leader to cell two.
insert into public.announcements (id, title, body, author_id, author_name, audience_spec_id) values
  ('00000000-0000-4000-8000-0000000000e1', 'Broadcast', 'b', '00000000-0000-4000-8000-0000000000a1', 'P Admin', null),
  ('00000000-0000-4000-8000-0000000000e2', 'Admin to one', 'b', '00000000-0000-4000-8000-0000000000a1', 'P Admin', '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-0000000000e3', 'Leader to one', 'b', '00000000-0000-4000-8000-0000000000a3', 'P Leader', '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-0000000000e4', 'Leader two to two', 'b', '00000000-0000-4000-8000-0000000000a4', 'P Leader Two', '00000000-0000-4000-8000-0000000000f2'),
  ('00000000-0000-4000-8000-0000000000e5', 'Rejected to two', 'b', '00000000-0000-4000-8000-0000000000a8', 'P Rejected', '00000000-0000-4000-8000-0000000000f2');

\set admin    '00000000-0000-4000-8000-0000000000a1'
\set coord    '00000000-0000-4000-8000-0000000000a2'
\set leader   '00000000-0000-4000-8000-0000000000a3'
\set leader2  '00000000-0000-4000-8000-0000000000a4'
\set member   '00000000-0000-4000-8000-0000000000a5'
\set pending  '00000000-0000-4000-8000-0000000000a6'
\set inactive '00000000-0000-4000-8000-0000000000a7'
\set rejected '00000000-0000-4000-8000-0000000000a8'
\set e1 '00000000-0000-4000-8000-0000000000e1'
\set e2 '00000000-0000-4000-8000-0000000000e2'
\set e3 '00000000-0000-4000-8000-0000000000e3'
\set e4 '00000000-0000-4000-8000-0000000000e4'
\set e5 '00000000-0000-4000-8000-0000000000e5'
\set s1 '00000000-0000-4000-8000-0000000000f1'
\set s2 '00000000-0000-4000-8000-0000000000f2'

-- ── Viewing ─────────────────────────────────────────────────────────────────────────────────────────────

select pg_temp.check('admin sees every post', pg_temp.as_visible_count(:'admin'::uuid) = 5);
select pg_temp.check('member sees the broadcast and posts to their own cell only', pg_temp.as_visible_count(:'member'::uuid) = 3);
select pg_temp.check('pending account sees nothing', pg_temp.as_visible_count(:'pending'::uuid) = 0);
select pg_temp.check('rejected account sees nothing', pg_temp.as_visible_count(:'rejected'::uuid) = 0);
select pg_temp.check('inactive account sees nothing', pg_temp.as_visible_count(:'inactive'::uuid) = 0);

-- ── Creating ────────────────────────────────────────────────────────────────────────────────────────────

select pg_temp.check('admin creates a broadcast', pg_temp.as_insert(:'admin'::uuid, :'admin'::uuid, null));
select pg_temp.check('coordinator creates a targeted post', pg_temp.as_insert(:'coord'::uuid, :'coord'::uuid, :'s2'::uuid));
select pg_temp.check('cell leader creates a post to their own cell', pg_temp.as_insert(:'leader'::uuid, :'leader'::uuid, :'s1'::uuid));
select pg_temp.check('cell leader cannot create a broadcast', pg_temp.as_insert(:'leader'::uuid, :'leader'::uuid, null) = false);
select pg_temp.check('cell leader cannot target a cell they do not lead', pg_temp.as_insert(:'leader'::uuid, :'leader'::uuid, :'s2'::uuid) = false);
select pg_temp.check('cell leader cannot post as another author', pg_temp.as_insert(:'leader'::uuid, :'admin'::uuid, :'s1'::uuid) = false);
select pg_temp.check('member cannot create', pg_temp.as_insert(:'member'::uuid, :'member'::uuid, null) = false);
select pg_temp.check('pending account cannot create', pg_temp.as_insert(:'pending'::uuid, :'pending'::uuid, :'s1'::uuid) = false);
select pg_temp.check('inactive account cannot create', pg_temp.as_insert(:'inactive'::uuid, :'inactive'::uuid, null) = false);

-- ── Editing ─────────────────────────────────────────────────────────────────────────────────────────────

select pg_temp.check('admin edits a leader post', pg_temp.as_update_title(:'admin'::uuid, :'e3'::uuid, 'Admin edited') = 1);
select pg_temp.check('admin edits a broadcast', pg_temp.as_update_title(:'admin'::uuid, :'e1'::uuid, 'Broadcast edited') = 1);
select pg_temp.check('edit by admin changed no other post',
  pg_temp.title_of(:'e2'::uuid) = 'Admin to one' and pg_temp.title_of(:'e4'::uuid) = 'Leader two to two'
  and pg_temp.title_of(:'e5'::uuid) = 'Rejected to two');
select pg_temp.check('cell leader edits their own targeted post', pg_temp.as_update_title(:'leader'::uuid, :'e3'::uuid, 'Leader edited') = 1);
select pg_temp.check('cell leader cannot edit a broadcast', pg_temp.as_update_title(:'leader'::uuid, :'e1'::uuid, 'Hacked') = 0);
select pg_temp.check('cell leader cannot edit an admin post', pg_temp.as_update_title(:'leader'::uuid, :'e2'::uuid, 'Hacked') = 0);
select pg_temp.check('cell leader cannot edit another leader post', pg_temp.as_update_title(:'leader'::uuid, :'e4'::uuid, 'Hacked') = 0);
select pg_temp.check('member cannot edit a post', pg_temp.as_update_title(:'member'::uuid, :'e3'::uuid, 'Hacked') = 0);
select pg_temp.check('rejected leader cannot edit their own post', pg_temp.as_update_title(:'rejected'::uuid, :'e5'::uuid, 'Hacked') = 0);
select pg_temp.check('pending account cannot edit a post', pg_temp.as_update_title(:'pending'::uuid, :'e3'::uuid, 'Hacked') = 0);
select pg_temp.check('inactive account cannot edit a post', pg_temp.as_update_title(:'inactive'::uuid, :'e1'::uuid, 'Hacked') = 0);
select pg_temp.check('refused edits left the posts unchanged',
  pg_temp.title_of(:'e1'::uuid) = 'Broadcast edited' and pg_temp.title_of(:'e2'::uuid) = 'Admin to one'
  and pg_temp.title_of(:'e4'::uuid) = 'Leader two to two' and pg_temp.title_of(:'e5'::uuid) = 'Rejected to two');

-- The audience is protected: no one can move a published post to another audience (trigger 105).
select pg_temp.check('cell leader cannot change the audience of their own post', pg_temp.as_update_spec(:'leader'::uuid, :'e3'::uuid, :'s2'::uuid) = -1);
select pg_temp.check('admin cannot change the audience of a published post', pg_temp.as_update_spec(:'admin'::uuid, :'e2'::uuid, :'s2'::uuid) = -1);
select pg_temp.check('audience is unchanged after the refused changes',
  pg_temp.spec_of(:'e3'::uuid) = :'s1'::uuid and pg_temp.spec_of(:'e2'::uuid) = :'s1'::uuid);

-- ── Deleting ─────────────────────────────────────────────────────────────────────────────────────────────

select pg_temp.check('cell leader cannot delete a broadcast', pg_temp.as_delete(:'leader'::uuid, :'e1'::uuid) = 0);
select pg_temp.check('cell leader cannot delete another leader post', pg_temp.as_delete(:'leader'::uuid, :'e4'::uuid) = 0);
select pg_temp.check('member cannot delete a post', pg_temp.as_delete(:'member'::uuid, :'e1'::uuid) = 0);
select pg_temp.check('rejected leader cannot delete their own post', pg_temp.as_delete(:'rejected'::uuid, :'e5'::uuid) = 0);
select pg_temp.check('refused deletes removed nothing', pg_temp.as_visible_count(:'admin'::uuid) = 8);

select pg_temp.check('cell leader deletes their own targeted post and reports 1 row', pg_temp.as_delete(:'leader'::uuid, :'e3'::uuid) = 1);
select pg_temp.check('admin deletes a post and reports 1 row', pg_temp.as_delete(:'admin'::uuid, :'e4'::uuid) = 1);
select pg_temp.check('delete removed only the selected posts',
  pg_temp.title_of(:'e1'::uuid) = 'Broadcast edited' and pg_temp.title_of(:'e2'::uuid) = 'Admin to one'
  and pg_temp.title_of(:'e5'::uuid) = 'Rejected to two' and pg_temp.as_visible_count(:'admin'::uuid) = 6);

select 'ANNOUNCEMENT PORT RLS CHECKS PASSED' as result;

rollback;
