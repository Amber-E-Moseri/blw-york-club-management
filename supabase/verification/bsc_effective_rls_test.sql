-- bsc_effective_rls_test.sql
--
-- Authorisation test against the REAL schema: run it on a database that has replayed every migration from empty
-- (supabase db reset --local). It uses no stand-in functions or tables. Every check reads the effective RLS policies
-- and the real helper functions (is_active_member, current_user_role, can_view_member, ...).
--
-- Each check states the INTENDED result for that actor. A check that fails is a finding, not a test to relax.
-- Everything runs in one transaction that is rolled back, so the database is left unchanged.
--
-- Run (local database only):
--   docker exec -i <db container> psql -U postgres -v ON_ERROR_STOP=1 < supabase/verification/bsc_effective_rls_test.sql

begin;
set local session_replication_role = replica;  -- skip FKs to auth.users and the profile guard trigger for fixtures

create schema rls_test;
create table rls_test.results (name text, ok boolean, detail text);
grant usage on schema rls_test to authenticated, anon;

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Actors. uuid prefixes: c = coordinator/admin/cell leader, b = BSC leaders, m = members.
--   CO   coordinator, active               AD   admin, active
--   COI  coordinator, INACTIVE             CL   cell leader of cell C1, active
--   LB1  active BSC leader of B1 (cell C1) LB2  active BSC leader of B2 (cell C1, unrelated to B1)
--   LB3  active BSC leader of B3 (fellowship F2, cross-fellowship)
--   LB4I INACTIVE leader of B4 (cell C1)   LBP  PENDING leader of B5 (cell C1)
--   M1,M2,M3  active members of B1,B2,B3   M4 member of B4 (inactive leader)   M5 member of B5 (pending leader)
--   MP   PENDING member of B1              MN   active member with no BSC

insert into public.fellowships (id, name) values
  ('f0000000-0000-0000-0000-00000000000a', 'Fellowship F1'),
  ('f0000000-0000-0000-0000-00000000000b', 'Fellowship F2');

insert into public.cells (id, name, leader_id, fellowship_id) values
  ('c0000000-0000-0000-0000-0000000000c1', 'Cell C1', '00000000-0000-0000-0000-00000000c003', 'f0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-0000000000c3', 'Cell C3', null,                                   'f0000000-0000-0000-0000-00000000000b');

insert into public.profiles (id, email, full_name, role, status, cell_id, bsc_id) values
  ('00000000-0000-0000-0000-00000000c001', 'co@t',   'Coordinator', 'coordinator', 'active',   null, null),
  ('00000000-0000-0000-0000-00000000a001', 'ad@t',   'Admin',       'admin',       'active',   null, null),
  ('00000000-0000-0000-0000-00000000c002', 'coi@t',  'Inactive coordinator', 'coordinator', 'inactive', null, null),
  ('00000000-0000-0000-0000-00000000c003', 'cl@t',   'Cell leader', 'cell_leader', 'active',   'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000b001', 'lb1@t',  'Leader B1',   'member',      'active',   'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000b002', 'lb2@t',  'Leader B2',   'member',      'active',   'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000b003', 'lb3@t',  'Leader B3',   'member',      'active',   'c0000000-0000-0000-0000-0000000000c3', null),
  ('00000000-0000-0000-0000-00000000b004', 'lb4@t',  'Inactive leader B4', 'member', 'inactive', 'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000b005', 'lbp@t',  'Pending leader B5',  'member', 'pending',  'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000d001', 'm1@t',   'Member 1', 'member', 'active',  'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000d002', 'm2@t',   'Member 2', 'member', 'active',  'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000d003', 'm3@t',   'Member 3', 'member', 'active',  'c0000000-0000-0000-0000-0000000000c3', null),
  ('00000000-0000-0000-0000-00000000d004', 'm4@t',   'Member 4', 'member', 'active',  'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000d005', 'm5@t',   'Member 5', 'member', 'active',  'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000d101', 'mp@t',   'Pending member', 'member', 'pending', 'c0000000-0000-0000-0000-0000000000c1', null),
  ('00000000-0000-0000-0000-00000000d201', 'mn@t',   'Member no BSC',  'member', 'active',  null, null);

insert into public.bscs (id, cell_id, name, leader_id) values
  ('b5000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B1', '00000000-0000-0000-0000-00000000b001'),
  ('b5000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B2', '00000000-0000-0000-0000-00000000b002'),
  ('b5000000-0000-0000-0000-0000000000b3', 'c0000000-0000-0000-0000-0000000000c3', 'BSC B3', '00000000-0000-0000-0000-00000000b003'),
  ('b5000000-0000-0000-0000-0000000000b4', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B4', '00000000-0000-0000-0000-00000000b004'),
  ('b5000000-0000-0000-0000-0000000000b5', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B5', '00000000-0000-0000-0000-00000000b005');

update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b1' where id in ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d101');
update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000d002';
update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b3' where id = '00000000-0000-0000-0000-00000000d003';
update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b4' where id = '00000000-0000-0000-0000-00000000d004';
update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b5' where id = '00000000-0000-0000-0000-00000000d005';

insert into public.confessions (id, title, body, scheduled_date, created_by, is_active) values
  ('e0000000-0000-0000-0000-0000000000e1', 'Confession', 'text', current_date, '00000000-0000-0000-0000-00000000c001', true);

-- One Rhapsody read and one confession declaration per member (and the pending member).
insert into public.devotional_views (member_id, devotional_id, day_of_month, viewed_date) values
  ('00000000-0000-0000-0000-00000000d001', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d002', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d003', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d004', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d005', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d101', 'd0000000-0000-0000-0000-000000000001', 1, current_date);

insert into public.confession_declarations (confession_id, user_id) values
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d001'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d002'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d003'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d004'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d005'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d101');

insert into public.books_of_month (id, title, author, drive_url, active_from, active_until, created_by) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Book', 'Author', 'https://example.org/b', current_date, current_date + 30, '00000000-0000-0000-0000-00000000c001');

-- ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
create function rls_test.as_user(p_user uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
end $fn$;

create function rls_test.as_owner() returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $fn$;

create function rls_test.expect_count(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform rls_test.as_user(p_user);
  execute 'select count(*) from (' || p_sql || ') q' into n;
  perform rls_test.as_owner();
  insert into rls_test.results values (p_name, n = p_expected, n || ' visible (expected ' || p_expected || ')');
end $fn$;

create function rls_test.expect_affected(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform rls_test.as_user(p_user);
  execute 'with x as (' || p_sql || ' returning 1) select count(*) from x' into n;
  perform rls_test.as_owner();
  insert into rls_test.results values (p_name, n = p_expected, n || ' rows affected (expected ' || p_expected || ')');
end $fn$;

create function rls_test.expect_denied(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $fn$
declare got text := 'allowed';
begin
  perform rls_test.as_user(p_user);
  begin
    execute p_sql;
  exception when others then
    got := sqlstate;
  end;
  perform rls_test.as_owner();
  insert into rls_test.results values (p_name, got in ('42501', '0A000'), 'got ' || got || ' (expected 42501 denied)');
end $fn$;

-- ─── Actor ids ───────────────────────────────────────────────────────────────────────────────────────────────────
-- (written inline below for readability)

-- ─── A. Rhapsody reads: public.devotional_views ─────────────────────────────────────────────────────────────────
select rls_test.expect_count('A1 coordinator sees all active members'' Rhapsody reads (pending excluded, F4)', '00000000-0000-0000-0000-00000000c001', 'select id from public.devotional_views', 5);
select rls_test.expect_count('A2 admin sees all active members'' Rhapsody reads (pending excluded, F4)', '00000000-0000-0000-0000-00000000a001', 'select id from public.devotional_views', 5);
select rls_test.expect_count('A3 INACTIVE coordinator sees no Rhapsody reads', '00000000-0000-0000-0000-00000000c002', 'select id from public.devotional_views', 0);
select rls_test.expect_count('A4 cell leader sees reads of members in cell C1 (not pending)', '00000000-0000-0000-0000-00000000c003', 'select id from public.devotional_views', 4);
select rls_test.expect_count('A5 BSC B1 leader sees only B1 active member', '00000000-0000-0000-0000-00000000b001', 'select id from public.devotional_views', 1);
select rls_test.expect_count('A6 unrelated BSC B2 leader sees only B2 member', '00000000-0000-0000-0000-00000000b002', 'select id from public.devotional_views', 1);
select rls_test.expect_count('A7 cross-fellowship BSC B3 leader sees only B3 member', '00000000-0000-0000-0000-00000000b003', 'select id from public.devotional_views', 1);
select rls_test.expect_count('A8 INACTIVE BSC leader sees no reads', '00000000-0000-0000-0000-00000000b004', 'select id from public.devotional_views', 0);
select rls_test.expect_count('A9 PENDING BSC leader sees no reads', '00000000-0000-0000-0000-00000000b005', 'select id from public.devotional_views', 0);
select rls_test.expect_count('A10 active member sees only own read', '00000000-0000-0000-0000-00000000d001', 'select id from public.devotional_views', 1);
select rls_test.expect_count('A11 member with no BSC sees nothing extra', '00000000-0000-0000-0000-00000000d201', 'select id from public.devotional_views', 0);
select rls_test.expect_count('A12 PENDING member sees no reads (own row included)', '00000000-0000-0000-0000-00000000d101', 'select id from public.devotional_views', 0);

-- ─── B. Confession declarations: public.confession_declarations ──────────────────────────────────────────────────
select rls_test.expect_count('B1 coordinator sees active members'' declarations (pending excluded, F4)', '00000000-0000-0000-0000-00000000c001', 'select 1 from public.confession_declarations', 5);
select rls_test.expect_count('B2 cell leader sees declarations of cell C1 members', '00000000-0000-0000-0000-00000000c003', 'select 1 from public.confession_declarations', 4);
select rls_test.expect_count('B3 BSC B1 leader sees only B1 member declaration', '00000000-0000-0000-0000-00000000b001', 'select 1 from public.confession_declarations', 1);
select rls_test.expect_count('B4 unrelated BSC B2 leader sees only B2 member', '00000000-0000-0000-0000-00000000b002', 'select 1 from public.confession_declarations', 1);
select rls_test.expect_count('B5 cross-fellowship BSC B3 leader sees only B3 member', '00000000-0000-0000-0000-00000000b003', 'select 1 from public.confession_declarations', 1);
select rls_test.expect_count('B6 INACTIVE BSC leader sees no declarations', '00000000-0000-0000-0000-00000000b004', 'select 1 from public.confession_declarations', 0);
select rls_test.expect_count('B7 PENDING BSC leader sees no declarations', '00000000-0000-0000-0000-00000000b005', 'select 1 from public.confession_declarations', 0);
select rls_test.expect_count('B8 active member sees only own declaration (BSC intent)', '00000000-0000-0000-0000-00000000d001', 'select 1 from public.confession_declarations', 1);
select rls_test.expect_count('B9 member with no BSC sees no other declarations', '00000000-0000-0000-0000-00000000d201', 'select 1 from public.confession_declarations', 0);
select rls_test.expect_count('B10 PENDING member sees no declarations', '00000000-0000-0000-0000-00000000d101', 'select 1 from public.confession_declarations', 0);

-- ─── C. Writes by leaders into member records ────────────────────────────────────────────────────────────────────
select rls_test.expect_affected('C1 BSC leader cannot update a member read', '00000000-0000-0000-0000-00000000b001',
  $q$update public.devotional_views set viewed_date = current_date where member_id = '00000000-0000-0000-0000-00000000d001'$q$, 0);
select rls_test.expect_denied('C2 BSC leader cannot insert a declaration for a member', '00000000-0000-0000-0000-00000000b001',
  $q$insert into public.confession_declarations (confession_id, user_id) values ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d001')$q$);
select rls_test.expect_affected('C3 BSC leader cannot edit BSC structure', '00000000-0000-0000-0000-00000000b001',
  $q$update public.bscs set name = 'x' where id = 'b5000000-0000-0000-0000-0000000000b2'$q$, 0);
select rls_test.expect_affected('C4 cell leader may rename a BSC in own cell', '00000000-0000-0000-0000-00000000c003',
  $q$update public.bscs set name = 'BSC B1 renamed' where id = 'b5000000-0000-0000-0000-0000000000b1'$q$, 1);

-- ─── D. Structure reads ─────────────────────────────────────────────────────────────────────────────────────────
select rls_test.expect_count('D1 PENDING member cannot read BSCs', '00000000-0000-0000-0000-00000000d101', 'select id from public.bscs', 0);
select rls_test.expect_count('D2 PENDING member cannot read fellowships', '00000000-0000-0000-0000-00000000d101', 'select id from public.fellowships', 0);
select rls_test.expect_count('D3 active member reads BSCs', '00000000-0000-0000-0000-00000000d001', 'select id from public.bscs', 5);
select rls_test.expect_count('D4 active member with no BSC reads fellowships', '00000000-0000-0000-0000-00000000d201', 'select id from public.fellowships', 2);

-- ─── E. books_of_month (monthly book) ───────────────────────────────────────────────────────────────────────────
select rls_test.expect_count('E1 active member reads the monthly book', '00000000-0000-0000-0000-00000000d001', 'select id from public.books_of_month', 1);
select rls_test.expect_count('E2 PENDING member cannot read the monthly book', '00000000-0000-0000-0000-00000000d101', 'select id from public.books_of_month', 0);
select rls_test.expect_denied('E3 active member cannot write the monthly book', '00000000-0000-0000-0000-00000000d001',
  $q$insert into public.books_of_month (title, author, drive_url, active_from, active_until, created_by) values ('x','y','https://e.org',current_date,current_date,'00000000-0000-0000-0000-00000000d001')$q$);
select rls_test.expect_affected('E4 INACTIVE coordinator cannot update the monthly book', '00000000-0000-0000-0000-00000000c002',
  $q$update public.books_of_month set title = 'hijack' where id = 'a0000000-0000-0000-0000-0000000000a1'$q$, 0);
select rls_test.expect_denied('E5 INACTIVE coordinator cannot insert a monthly book', '00000000-0000-0000-0000-00000000c002',
  $q$insert into public.books_of_month (title, author, drive_url, active_from, active_until, created_by) values ('x','y','https://e.org',current_date,current_date,'00000000-0000-0000-0000-00000000c002')$q$);
select rls_test.expect_affected('E6 active coordinator may update the monthly book', '00000000-0000-0000-0000-00000000c001',
  $q$update public.books_of_month set title = 'Book (ok)' where id = 'a0000000-0000-0000-0000-0000000000a1'$q$, 1);

-- ─── F. Same inline role-only pattern on other tables (cells) ───────────────────────────────────────────────────
select rls_test.expect_denied('F1 INACTIVE coordinator cannot create a cell', '00000000-0000-0000-0000-00000000c002',
  $q$insert into public.cells (name, fellowship_id) values ('Rogue cell', 'f0000000-0000-0000-0000-00000000000a')$q$);

select * from rls_test.results order by name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from rls_test.results;

rollback;
