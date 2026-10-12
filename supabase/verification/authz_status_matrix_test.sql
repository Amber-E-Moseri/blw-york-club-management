-- authz_status_matrix_test.sql
--
-- Real-schema authorisation matrix for account status (F1-F5). Run on a database that has replayed every migration
-- from empty, through migration 045. No stand-ins. Everything rolls back.
--
--   docker exec -i <db container> psql -U postgres -v ON_ERROR_STOP=1 < supabase/verification/authz_status_matrix_test.sql
--
-- Each check states the INTENDED result. A failed check is a finding. Do not relax an expectation to pass.
-- Statuses exercised: active, pending, rejected, inactive.

begin;
set local session_replication_role = replica;  -- fixtures only: skip FKs to auth.users and the profile guard trigger

create schema authz_test;
grant usage on schema authz_test to authenticated, anon;
create table authz_test.results (name text, ok boolean, detail text);

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.fellowships (id, name) values
  ('f0000000-0000-0000-0000-00000000000a', 'Fellowship F1'),
  ('f0000000-0000-0000-0000-00000000000b', 'Fellowship F2');

insert into public.cells (id, name, leader_id, fellowship_id) values
  ('c0000000-0000-0000-0000-0000000000c1', 'Cell C1', '00000000-0000-0000-0000-00000000c003', 'f0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-0000000000c2', 'Cell C2 (inactive leader)', '00000000-0000-0000-0000-00000000c006', 'f0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-0000000000c3', 'Cell C3 (fellowship F2)', null, 'f0000000-0000-0000-0000-00000000000b');

insert into public.profiles (id, email, full_name, role, status, cell_id) values
  ('00000000-0000-0000-0000-00000000c001', 'co@t',   'Coordinator active',     'coordinator', 'active',   null),
  ('00000000-0000-0000-0000-00000000c002', 'coi@t',  'Coordinator inactive',   'coordinator', 'inactive', null),
  ('00000000-0000-0000-0000-00000000c004', 'cop@t',  'Coordinator pending',    'coordinator', 'pending',  null),
  ('00000000-0000-0000-0000-00000000c005', 'cor@t',  'Coordinator rejected',   'coordinator', 'rejected', null),
  ('00000000-0000-0000-0000-00000000a001', 'ad@t',   'Admin active',           'admin',       'active',   null),
  ('00000000-0000-0000-0000-00000000c003', 'cl@t',   'Cell leader C1 active',  'cell_leader', 'active',   'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000c006', 'cli@t',  'Cell leader C2 inactive','cell_leader', 'inactive', 'c0000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-00000000b001', 'lb1@t',  'BSC leader B1 active',   'member',      'active',   'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000b002', 'lb2@t',  'BSC leader B2 active',   'member',      'active',   'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000b003', 'lb3@t',  'BSC leader B3 active',   'member',      'active',   'c0000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-00000000b004', 'lb4@t',  'BSC leader B4 inactive', 'member',      'inactive', 'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000b005', 'lb5@t',  'BSC leader B5 pending',  'member',      'pending',  'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000b006', 'lb6@t',  'BSC leader B6 rejected', 'member',      'rejected', 'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000d001', 'm1@t',   'Member 1 active',        'member',      'active',   'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000d002', 'm2@t',   'Member 2 active',        'member',      'active',   'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000d003', 'm3@t',   'Member 3 active',        'member',      'active',   'c0000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-00000000d004', 'm4@t',   'Member 4 active',        'member',      'active',   'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000d005', 'm5@t',   'Member 5 active',        'member',      'active',   'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000d101', 'mp@t',   'Member pending',         'member',      'pending',  'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000d102', 'mr@t',   'Member rejected',        'member',      'rejected', 'c0000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000d201', 'mn@t',   'Member no BSC',          'member',      'active',   null);

insert into public.bscs (id, cell_id, name, leader_id) values
  ('b5000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B1', '00000000-0000-0000-0000-00000000b001'),
  ('b5000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B2', '00000000-0000-0000-0000-00000000b002'),
  ('b5000000-0000-0000-0000-0000000000b3', 'c0000000-0000-0000-0000-0000000000c3', 'BSC B3', '00000000-0000-0000-0000-00000000b003'),
  ('b5000000-0000-0000-0000-0000000000b4', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B4', '00000000-0000-0000-0000-00000000b004'),
  ('b5000000-0000-0000-0000-0000000000b5', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B5', '00000000-0000-0000-0000-00000000b005'),
  ('b5000000-0000-0000-0000-0000000000b6', 'c0000000-0000-0000-0000-0000000000c1', 'BSC B6', '00000000-0000-0000-0000-00000000b006');

update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b1' where id in ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000d102');
update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000d002';
update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b3' where id = '00000000-0000-0000-0000-00000000d003';
update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b4' where id = '00000000-0000-0000-0000-00000000d004';
update public.profiles set bsc_id = 'b5000000-0000-0000-0000-0000000000b5' where id = '00000000-0000-0000-0000-00000000d005';

-- Rhapsody reads: one per member (incl. pending and rejected)
insert into public.devotional_views (member_id, devotional_id, day_of_month, viewed_date) values
  ('00000000-0000-0000-0000-00000000d001', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d002', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d003', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d004', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d005', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d101', 'd0000000-0000-0000-0000-000000000001', 1, current_date),
  ('00000000-0000-0000-0000-00000000d102', 'd0000000-0000-0000-0000-000000000001', 1, current_date);

insert into public.confessions (id, title, body, scheduled_date, created_by, is_active) values
  ('e0000000-0000-0000-0000-0000000000e1', 'Confession', 'text', current_date, '00000000-0000-0000-0000-00000000c001', true);
insert into public.confession_declarations (confession_id, user_id) values
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d001'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d002'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d003'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d004'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d005'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d101'),
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d102');

insert into public.books_of_month (id, title, author, drive_url, active_from, active_until, created_by) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Book', 'Author', 'https://example.org/b', current_date, current_date + 30, '00000000-0000-0000-0000-00000000c001');

insert into public.habit_templates (id, name, icon, created_by) values
  ('a1000000-0000-0000-0000-0000000000a1', 'Prayer walk', '*', '00000000-0000-0000-0000-00000000c001');
insert into public.habit_entries (template_id, user_id, entry_date, status) values
  ('a1000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', current_date, 'done'),
  ('a1000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d101', current_date, 'done');

insert into public.prayer_requests (id, content, author_id, author_name, visibility) values
  ('a2000000-0000-0000-0000-0000000000f1', 'P1 leadership by active M1', '00000000-0000-0000-0000-00000000d001', 'M1', 'leadership'),
  ('a2000000-0000-0000-0000-0000000000f2', 'P2 leadership by PENDING MP', '00000000-0000-0000-0000-00000000d101', 'MP', 'leadership'),
  ('a2000000-0000-0000-0000-0000000000f3', 'P3 shared by active M3', '00000000-0000-0000-0000-00000000d003', 'M3', 'shared');

insert into public.foundation_school_classes (id, class_number, title) values
  ('a3000000-0000-0000-0000-0000000000c1', 1, 'Class 1');
insert into public.foundation_school_enrollments (id, student_id, teacher_id) values
  ('a4000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000b001'),
  ('a4000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000b001');

insert into public.email_log (recipient_email, subject) values ('someone@t', 'Test subject');

-- ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
create function authz_test.as_user(p_user uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
end $fn$;

create function authz_test.as_owner() returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $fn$;

create function authz_test.expect_count(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform authz_test.as_user(p_user);
  execute 'select count(*) from (' || p_sql || ') q' into n;
  perform authz_test.as_owner();
  insert into authz_test.results values (p_name, n = p_expected, n || ' visible (expected ' || p_expected || ')');
end $fn$;

create function authz_test.expect_value(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform authz_test.as_user(p_user);
  execute p_sql into n;
  perform authz_test.as_owner();
  insert into authz_test.results values (p_name, coalesce(n, 0) = p_expected, coalesce(n, 0) || ' (expected ' || p_expected || ')');
end $fn$;

create function authz_test.expect_affected(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform authz_test.as_user(p_user);
  execute 'with x as (' || p_sql || ' returning 1) select count(*) from x' into n;
  perform authz_test.as_owner();
  insert into authz_test.results values (p_name, n = p_expected, n || ' rows affected (expected ' || p_expected || ')');
end $fn$;

create function authz_test.expect_denied(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $fn$
declare got text := 'allowed';
begin
  perform authz_test.as_user(p_user);
  begin
    execute p_sql;
  exception when others then
    got := sqlstate;
  end;
  perform authz_test.as_owner();
  insert into authz_test.results values (p_name, got in ('42501', '0A000'), 'got ' || got || ' (expected 42501 denied)');
end $fn$;

-- Actor ids (readability): CO c001 active coordinator | COI c002 inactive | COP c004 pending | COR c005 rejected
-- AD a001 active admin | CL c003 active cell leader C1 | CLI c006 inactive cell leader C2
-- LB1 b001 active BSC B1 | LB2 b002 active B2 | LB3 b003 active B3 (fellowship F2) | LB4I b004 inactive B4
-- LBP b005 pending B5 | LBR b006 rejected B6 | M1..M5 d001..d005 active | MP d101 pending | MR d102 rejected | MN d201 no BSC

-- ─── A. F1: staff authority requires an active account ──────────────────────────────────────────────────────────
select authz_test.expect_affected('A1 active coordinator updates the monthly book', '00000000-0000-0000-0000-00000000c001',
  $q$update public.books_of_month set title = 'ok' where id = 'a0000000-0000-0000-0000-0000000000a1'$q$, 1);
select authz_test.expect_affected('A2 inactive coordinator cannot update the monthly book', '00000000-0000-0000-0000-00000000c002',
  $q$update public.books_of_month set title = 'hijack' where id = 'a0000000-0000-0000-0000-0000000000a1'$q$, 0);
select authz_test.expect_denied('A3 pending coordinator cannot insert a monthly book', '00000000-0000-0000-0000-00000000c004',
  $q$insert into public.books_of_month (title, author, drive_url, active_from, active_until, created_by) values ('x','y','https://e.org',current_date,current_date,'00000000-0000-0000-0000-00000000c004')$q$);
select authz_test.expect_denied('A4 rejected coordinator cannot insert a monthly book', '00000000-0000-0000-0000-00000000c005',
  $q$insert into public.books_of_month (title, author, drive_url, active_from, active_until, created_by) values ('x','y','https://e.org',current_date,current_date,'00000000-0000-0000-0000-00000000c005')$q$);
select authz_test.expect_affected('A5 active admin may update the monthly book', '00000000-0000-0000-0000-00000000a001',
  $q$update public.books_of_month set title = 'admin ok' where id = 'a0000000-0000-0000-0000-0000000000a1'$q$, 1);
select authz_test.expect_denied('A6 inactive coordinator cannot create a cell', '00000000-0000-0000-0000-00000000c002',
  $q$insert into public.cells (name, fellowship_id) values ('rogue', 'f0000000-0000-0000-0000-00000000000a')$q$);
select authz_test.expect_denied('A7 rejected coordinator cannot create a cell', '00000000-0000-0000-0000-00000000c005',
  $q$insert into public.cells (name, fellowship_id) values ('rogue', 'f0000000-0000-0000-0000-00000000000a')$q$);
select authz_test.expect_count('A8 inactive coordinator cannot read email log', '00000000-0000-0000-0000-00000000c002', 'select id from public.email_log', 0);
select authz_test.expect_count('A9 active coordinator reads email log', '00000000-0000-0000-0000-00000000c001', 'select id from public.email_log', 1);
select authz_test.expect_denied('A10 inactive cell leader cannot create a meeting in own cell', '00000000-0000-0000-0000-00000000c006',
  $q$insert into public.meetings (title, date, time, visibility, created_by, category, cell_id) values ('x', current_date, '10:00', 'cell', '00000000-0000-0000-0000-00000000c006', 'cell', 'c0000000-0000-0000-0000-0000000000c2')$q$);
select authz_test.expect_affected('A11 active cell leader may create a meeting in own cell', '00000000-0000-0000-0000-00000000c003',
  $q$insert into public.meetings (title, date, time, visibility, created_by, category, cell_id) values ('x', current_date, '10:00', 'cell', '00000000-0000-0000-0000-00000000c003', 'cell', 'c0000000-0000-0000-0000-0000000000c1')$q$, 1);
select authz_test.expect_count('A12 inactive coordinator reads no Rhapsody reads', '00000000-0000-0000-0000-00000000c002', 'select id from public.devotional_views', 0);
select authz_test.expect_count('A13 pending coordinator reads no Rhapsody reads', '00000000-0000-0000-0000-00000000c004', 'select id from public.devotional_views', 0);

-- ─── B. F3 + F4: BSC leaders and member records ─────────────────────────────────────────────────────────────────
select authz_test.expect_count('B1 active BSC leader B1 sees only B1 active member reads', '00000000-0000-0000-0000-00000000b001', 'select id from public.devotional_views', 1);
select authz_test.expect_count('B2 active BSC leader B2 sees only B2 member reads (unrelated leader)', '00000000-0000-0000-0000-00000000b002', 'select id from public.devotional_views', 1);
select authz_test.expect_count('B3 cross-fellowship leader B3 sees only B3 member reads', '00000000-0000-0000-0000-00000000b003', 'select id from public.devotional_views', 1);
select authz_test.expect_count('B4 inactive BSC leader sees no member reads', '00000000-0000-0000-0000-00000000b004', 'select id from public.devotional_views', 0);
select authz_test.expect_count('B5 pending BSC leader sees no member reads', '00000000-0000-0000-0000-00000000b005', 'select id from public.devotional_views', 0);
select authz_test.expect_count('B6 rejected BSC leader sees no member reads', '00000000-0000-0000-0000-00000000b006', 'select id from public.devotional_views', 0);
select authz_test.expect_count('B7 inactive BSC leader sees no declarations', '00000000-0000-0000-0000-00000000b004', 'select 1 from public.confession_declarations', 0);
select authz_test.expect_count('B8 pending BSC leader sees no declarations', '00000000-0000-0000-0000-00000000b005', 'select 1 from public.confession_declarations', 0);
select authz_test.expect_count('B9 rejected BSC leader sees no declarations', '00000000-0000-0000-0000-00000000b006', 'select 1 from public.confession_declarations', 0);
select authz_test.expect_count('B10 cell leader C1 (active) sees reads of active members in C1 only', '00000000-0000-0000-0000-00000000c003', 'select id from public.devotional_views', 4);
select authz_test.expect_count('B11 inactive cell leader C2 sees nothing', '00000000-0000-0000-0000-00000000c006', 'select id from public.devotional_views', 0);
select authz_test.expect_count('B12 onboarding: active BSC leader B1 lists its active and pending members (not rejected)', '00000000-0000-0000-0000-00000000b001', 'select id from public.bsc_members_visible()', 2);
select authz_test.expect_count('B13 onboarding: cross-BSC leader B2 lists only B2 members', '00000000-0000-0000-0000-00000000b002', 'select id from public.bsc_members_visible()', 1);
select authz_test.expect_count('B14 onboarding: cross-fellowship leader B3 lists only B3 members', '00000000-0000-0000-0000-00000000b003', 'select id from public.bsc_members_visible()', 1);
select authz_test.expect_count('B15 onboarding: inactive BSC leader lists nobody', '00000000-0000-0000-0000-00000000b004', 'select id from public.bsc_members_visible()', 0);
select authz_test.expect_count('B16 onboarding: pending BSC leader lists nobody', '00000000-0000-0000-0000-00000000b005', 'select id from public.bsc_members_visible()', 0);
select authz_test.expect_count('B17 onboarding: admin lists all active and pending BSC members', '00000000-0000-0000-0000-00000000a001', 'select id from public.bsc_members_visible()', 6);
select authz_test.expect_count('B18 onboarding: pending member cannot use the BSC list', '00000000-0000-0000-0000-00000000d101', 'select id from public.bsc_members_visible()', 0);
select authz_test.expect_denied('B19 BSC leader cannot insert a Rhapsody read for a member', '00000000-0000-0000-0000-00000000b001',
  $q$insert into public.devotional_views (member_id, devotional_id, day_of_month, viewed_date) values ('00000000-0000-0000-0000-00000000d001', 'd0000000-0000-0000-0000-000000000002', 2, current_date)$q$);
select authz_test.expect_affected('B20 BSC leader cannot edit BSC structure outside cell scope', '00000000-0000-0000-0000-00000000b001',
  $q$update public.bscs set name = 'x' where id = 'b5000000-0000-0000-0000-0000000000b3'$q$, 0);

-- ─── C. F2: confession declarations: personal status and aggregate counts only ───────────────────────────────────
select authz_test.expect_count('C1 active member sees only own declaration row', '00000000-0000-0000-0000-00000000d001', 'select 1 from public.confession_declarations', 1);
select authz_test.expect_count('C2 active member cannot see another member declaration row', '00000000-0000-0000-0000-00000000d002', 'select 1 from public.confession_declarations where user_id = ''00000000-0000-0000-0000-00000000d001''', 0);
select authz_test.expect_count('C3 active member with no BSC sees no declaration rows', '00000000-0000-0000-0000-00000000d201', 'select 1 from public.confession_declarations', 0);
select authz_test.expect_count('C4 count RPC returns one row per confession for an active member', '00000000-0000-0000-0000-00000000d201', $q$select confession_id from public.confession_declaration_counts(array['e0000000-0000-0000-0000-0000000000e1'::uuid])$q$, 1);
select authz_test.expect_value('C5 count RPC total counts active members only (5 of 7 rows; pending and rejected excluded)', '00000000-0000-0000-0000-00000000d201',
  $q$select coalesce(sum(declaration_count),0)::bigint from public.confession_declaration_counts(array['e0000000-0000-0000-0000-0000000000e1'::uuid])$q$, 5);
select authz_test.expect_value('C6 active member sees own declared status via count caller path (own row)', '00000000-0000-0000-0000-00000000d001',
  $q$select count(*)::bigint from public.confession_declarations where user_id = '00000000-0000-0000-0000-00000000d001'$q$, 1);
select authz_test.expect_value('C7 pending member cannot use the count RPC', '00000000-0000-0000-0000-00000000d101',
  $q$select count(*)::bigint from public.confession_declaration_counts(array['e0000000-0000-0000-0000-0000000000e1'::uuid])$q$, 0);
select authz_test.expect_value('C8 inactive BSC leader cannot use the count RPC', '00000000-0000-0000-0000-00000000b004',
  $q$select count(*)::bigint from public.confession_declaration_counts(array['e0000000-0000-0000-0000-0000000000e1'::uuid])$q$, 0);
-- Decision 4: a BSC leader reads no declaration identity. Counts only, through the RPC (C9b).
select authz_test.expect_count('C9 active BSC leader B1 reads no declaration identities', '00000000-0000-0000-0000-00000000b001', 'select 1 from public.confession_declarations', 0);
select authz_test.expect_value('C9b active BSC leader B1 gets declaration counts via RPC', '00000000-0000-0000-0000-00000000b001',
  $q$select coalesce(sum(declaration_count),0)::bigint from public.confession_declaration_counts(array['e0000000-0000-0000-0000-0000000000e1'::uuid])$q$, 5);
select authz_test.expect_count('C10 coordinator sees declarations of active members only', '00000000-0000-0000-0000-00000000c001', 'select 1 from public.confession_declarations', 5);
select authz_test.expect_value('C11 broad declaration read policy removed', '00000000-0000-0000-0000-00000000c001',
  $q$select count(*)::bigint from pg_policies where schemaname='public' and tablename='confession_declarations' and policyname='confession_declarations_read'$q$, 0);

-- ─── D. F5: pending and rejected accounts: self profile, but no protected growth or devotional records ─────────────
select authz_test.expect_count('D1 pending member reads own profile (onboarding)', '00000000-0000-0000-0000-00000000d101', 'select id from public.profiles where id = auth.uid()', 1);
select authz_test.expect_affected('D2 pending member may complete own onboarding profile', '00000000-0000-0000-0000-00000000d101',
  $q$update public.profiles set full_name = 'Member pending (completed)' where id = '00000000-0000-0000-0000-00000000d101'$q$, 1);
select authz_test.expect_affected('D3 rejected member cannot update own profile', '00000000-0000-0000-0000-00000000d102',
  $q$update public.profiles set full_name = 'x' where id = '00000000-0000-0000-0000-00000000d102'$q$, 0);
select authz_test.expect_count('D4 rejected member reads own profile (status message)', '00000000-0000-0000-0000-00000000d102', 'select id from public.profiles where id = auth.uid()', 1);
select authz_test.expect_count('D5 pending member reads no own Rhapsody reads', '00000000-0000-0000-0000-00000000d101', 'select id from public.devotional_views', 0);
select authz_test.expect_count('D6 pending member reads no own habit entries', '00000000-0000-0000-0000-00000000d101', 'select id from public.habit_entries', 0);
select authz_test.expect_count('D7 active member reads own habit entries', '00000000-0000-0000-0000-00000000d001', 'select id from public.habit_entries', 1);
select authz_test.expect_count('D8 pending member reads no own prayer requests', '00000000-0000-0000-0000-00000000d101', 'select id from public.prayer_requests where author_id = auth.uid()', 0);
select authz_test.expect_count('D9 pending member reads no own Foundation School enrolment', '00000000-0000-0000-0000-00000000d101', 'select id from public.foundation_school_enrollments', 0);
select authz_test.expect_count('D10 active member reads own Foundation School enrolment', '00000000-0000-0000-0000-00000000d001', 'select id from public.foundation_school_enrollments', 1);
select authz_test.expect_denied('D11 pending member cannot create a habit entry', '00000000-0000-0000-0000-00000000d101',
  $q$insert into public.habit_entries (template_id, user_id, entry_date, status) values ('a1000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d101', current_date, 'done')$q$);
select authz_test.expect_denied('D12 pending member cannot write a Rhapsody read', '00000000-0000-0000-0000-00000000d101',
  $q$insert into public.devotional_views (member_id, devotional_id, day_of_month, viewed_date) values ('00000000-0000-0000-0000-00000000d101', 'd0000000-0000-0000-0000-000000000003', 3, current_date)$q$);
select authz_test.expect_count('D13 pending member cannot read any books of the month', '00000000-0000-0000-0000-00000000d101', 'select id from public.books_of_month', 0);
select authz_test.expect_count('D14 active member reads books of the month', '00000000-0000-0000-0000-00000000d201', 'select id from public.books_of_month', 1);

-- ─── E. F4: pending members' growth and prayer activity hidden from staff, leaders and teachers ─────────────────
select authz_test.expect_count('E1 active coordinator sees enrolments of pending and active students (onboarding, T6)', '00000000-0000-0000-0000-00000000c001', 'select id from public.foundation_school_enrollments', 2);
select authz_test.expect_count('E2 teacher LB1 (active) sees only the active student enrolment', '00000000-0000-0000-0000-00000000b001', 'select id from public.foundation_school_enrollments', 1);
select authz_test.expect_count('E3 active coordinator sees active-author leadership prayers and shared (P1, P3)', '00000000-0000-0000-0000-00000000c001', 'select id from public.prayer_requests where visibility in (''leadership'',''shared'')', 2);
select authz_test.expect_count('E4 active cell leader sees active-author leadership prayers (P1, P3)', '00000000-0000-0000-0000-00000000c003', 'select id from public.prayer_requests where visibility in (''leadership'',''shared'')', 2);
select authz_test.expect_count('E5 inactive coordinator sees no leadership prayers', '00000000-0000-0000-0000-00000000c002', 'select id from public.prayer_requests where visibility = ''leadership''', 0);
select authz_test.expect_count('E6 active member sees shared prayer of an active author (P3)', '00000000-0000-0000-0000-00000000d201', 'select id from public.prayer_requests', 1);
select authz_test.expect_count('E7 cross-fellowship leader B3 sees no habit entries of B1 members', '00000000-0000-0000-0000-00000000b003', 'select id from public.habit_entries', 0);

-- ─── F. Cross-fellowship and cross-BSC isolation on structure ───────────────────────────────────────────────────
select authz_test.expect_count('F1 active member in no BSC reads all fellowships (structure only)', '00000000-0000-0000-0000-00000000d201', 'select id from public.fellowships', 2);
select authz_test.expect_count('F2 pending member reads no fellowships', '00000000-0000-0000-0000-00000000d101', 'select id from public.fellowships', 0);
select authz_test.expect_count('F3 rejected member reads no BSCs', '00000000-0000-0000-0000-00000000d102', 'select id from public.bscs', 0);

-- ─── H. Prayer visibility after 047: active authors only, cross-cell leader scope, moderation ─────────────────────
-- Fixtures added after every check above, so the earlier expectations keep their meaning.
insert into public.profiles (id, email, full_name, role, status, cell_id) values
  ('00000000-0000-0000-0000-00000000c007', 'cl2@t', 'Cell leader C2 active', 'cell_leader', 'active', 'c0000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-00000000d202', 'mi@t',  'Member inactive (author)', 'member', 'inactive', 'c0000000-0000-0000-0000-0000000000c1');
insert into public.prayer_requests (id, content, author_id, author_name, visibility) values
  ('a2000000-0000-0000-0000-0000000000f4', 'H4 shared by INACTIVE author d202', '00000000-0000-0000-0000-00000000d202', 'Inactive', 'shared'),
  ('a2000000-0000-0000-0000-0000000000f5', 'H5 leadership by INACTIVE author d202', '00000000-0000-0000-0000-00000000d202', 'Inactive', 'leadership'),
  ('a2000000-0000-0000-0000-0000000000f6', 'H6 shared by REJECTED author d102', '00000000-0000-0000-0000-00000000d102', 'Rejected', 'shared'),
  ('a2000000-0000-0000-0000-0000000000f7', 'H7 shared by active d001 (cell C1)', '00000000-0000-0000-0000-00000000d001', 'M1', 'shared'),
  ('a2000000-0000-0000-0000-0000000000f8', 'H8 leadership by active d003 (cell C3, cross-cell)', '00000000-0000-0000-0000-00000000d003', 'M3', 'leadership');

-- Members: shared prayers of active authors only (T7)
select authz_test.expect_count('H1 active member sees shared prayers of ACTIVE authors only (f3, f7)', '00000000-0000-0000-0000-00000000d201',
  'select id from public.prayer_requests where visibility = ''shared''', 2);
select authz_test.expect_count('H2 active member in cell C1 sees no leadership prayers', '00000000-0000-0000-0000-00000000d002',
  'select id from public.prayer_requests where visibility = ''leadership''', 0);
-- Cell leader C1: leadership prayers of its OWN cell's active authors; shared prayers of active authors
select authz_test.expect_count('H3 cell leader C1 sees own-cell leadership (f1) and active shared (f3, f7), not cross-cell f8', '00000000-0000-0000-0000-00000000c003',
  'select id from public.prayer_requests', 3);
select authz_test.expect_count('H4 cell leader C2 sees no leadership prayers from cell C1 or C3', '00000000-0000-0000-0000-00000000c007',
  'select id from public.prayer_requests where visibility = ''leadership''', 0);
select authz_test.expect_count('H5 cell leader C2 sees active shared prayers only (f3, f7)', '00000000-0000-0000-0000-00000000c007',
  'select id from public.prayer_requests', 2);
-- Staff: leadership and shared prayers of ACTIVE authors across cells
select authz_test.expect_count('H6 active coordinator sees active authors'' leadership and shared prayers (f1, f3, f7, f8)', '00000000-0000-0000-0000-00000000c001',
  'select id from public.prayer_requests', 4);
select authz_test.expect_count('H7 active admin sees active authors'' leadership and shared prayers (f1, f3, f7, f8)', '00000000-0000-0000-0000-00000000a001',
  'select id from public.prayer_requests', 4);
select authz_test.expect_count('H8 inactive coordinator sees no prayers', '00000000-0000-0000-0000-00000000c002',
  'select id from public.prayer_requests', 0);
-- Authors: own prayers while active; none once inactive or rejected (F5)
select authz_test.expect_count('H9 active author reads own prayers (f1, f7)', '00000000-0000-0000-0000-00000000d001',
  'select id from public.prayer_requests where author_id = auth.uid()', 2);
select authz_test.expect_count('H10 INACTIVE author reads no own prayers', '00000000-0000-0000-0000-00000000d202',
  'select id from public.prayer_requests where author_id = auth.uid()', 0);
select authz_test.expect_count('H11 REJECTED author reads no own prayers', '00000000-0000-0000-0000-00000000d102',
  'select id from public.prayer_requests where author_id = auth.uid()', 0);
-- Moderation: active staff may moderate prayers they can read; leaders and members may not
select authz_test.expect_affected('H12 active coordinator moderates an ACTIVE author leadership prayer', '00000000-0000-0000-0000-00000000c001',
  $q$update public.prayer_requests set is_active = true where id = 'a2000000-0000-0000-0000-0000000000f1'$q$, 1);
select authz_test.expect_affected('H13 cell leader cannot moderate prayers (no moderation role)', '00000000-0000-0000-0000-00000000c003',
  $q$update public.prayer_requests set is_active = true where id = 'a2000000-0000-0000-0000-0000000000f1'$q$, 0);
select authz_test.expect_affected('H14 member cannot moderate a shared prayer', '00000000-0000-0000-0000-00000000d201',
  $q$update public.prayer_requests set is_active = true where id = 'a2000000-0000-0000-0000-0000000000f7'$q$, 0);
select authz_test.expect_affected('H15 coordinator cannot moderate a prayer of an INACTIVE author (not readable; decision T7)', '00000000-0000-0000-0000-00000000c001',
  $q$update public.prayer_requests set is_active = true where id = 'a2000000-0000-0000-0000-0000000000f5'$q$, 0);

select * from authz_test.results order by name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from authz_test.results;

rollback;
