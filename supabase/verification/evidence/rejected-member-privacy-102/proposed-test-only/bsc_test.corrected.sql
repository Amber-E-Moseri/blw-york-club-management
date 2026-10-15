-- bsc_remediation_rls_test.sql
--
-- Real-schema authorisation tests for migration 052 (BSC and cell-leadership remediation).
-- Run on a database that has replayed every migration from empty (supabase db reset --local). Local only.
--
-- Every check runs as an authenticated session (set local role authenticated + request.jwt.claim.sub), so RLS and the
-- SECURITY DEFINER helpers are evaluated exactly as an API caller would hit them.
--
-- Denials are checked by SQLSTATE AND message, so an unrelated fixture error cannot pass as an authorisation denial:
--   42501  authorisation denial (RLS violation or an explicit "Not authorised" raise)
--   P0001  validation refusal (invalid leader, wrong cell, non-empty BSC, inactive member)
--   P0002  zero-row write or unknown member (must never be reported as success)
-- Zero-row UPDATE cases are checked by row count, because RLS filters them silently.
--
-- Fixtures are inserted with session_replication_role = replica (skips the auth.users foreign keys). The four guard
-- triggers are then forced on with ENABLE ALWAYS, so every check below runs through the real trigger logic.
--
-- Everything is inside one transaction that is rolled back.

begin;
set local session_replication_role = replica;

create schema rls_test;
create table rls_test.results (name text, ok boolean, detail text);
grant usage on schema rls_test to authenticated, anon;

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

-- A write that must succeed and touch exactly p_expected rows (RETURNING counts rows for UPDATE / DELETE / INSERT).
create function rls_test.expect_rows(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint; err text;
begin
  perform rls_test.as_user(p_user);
  begin
    execute 'with x as (' || p_sql || ' returning 1) select count(*) from x' into n;
  exception when others then
    get stacked diagnostics err = message_text;
    n := -1;
  end;
  perform rls_test.as_owner();
  insert into rls_test.results values (p_name, n = p_expected,
    case when n = -1 then 'ERROR: ' || err else n || ' rows (expected ' || p_expected || ')' end);
end $fn$;

-- A statement that must raise a specific SQLSTATE with a message matching p_msg (LIKE pattern).
create function rls_test.expect_error(p_name text, p_user uuid, p_sql text, p_state text, p_msg text) returns void language plpgsql as $fn$
declare v_state text; v_msg text; v_ok boolean := false; v_detail text;
begin
  perform rls_test.as_user(p_user);
  begin
    execute p_sql;
    v_detail := 'NO ERROR: write succeeded (expected ' || p_state || ')';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    v_ok := v_state = p_state and v_msg like p_msg;
    v_detail := v_state || ': ' || v_msg;
  end;
  perform rls_test.as_owner();
  insert into rls_test.results values (p_name, v_ok, v_detail);
end $fn$;

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Cells: C1 led by CL1 (cells.leader_id); C2 led by CLX.
-- CLR  role 'cell_leader' in C1 but NOT cells.leader_id (role-only leader).
-- CLX  leads C2 while its profile cell is C1 (assigned leader whose profile cell differs).
-- BL1  active leader of B1 (C1), role member.   BL2 active leader of B2 (C2), role member.
-- BL1M leader of B4 (C1); profile later moved to C2 (stale leadership).
-- BLI  INACTIVE leader of B6 (C1), inserted as legacy invalid data (leadership written before the guard existed).
-- M1 active in B1 (C1). M2 active in B2 (C2). M3 active, no BSC (C1). MP pending (C1). MR rejected in B1 (C1).
-- MI inactive in B1 (C1). MN active, no cell, no BSC. AD admin. AI inactive admin. CO coordinator. COI inactive coord.

insert into public.cells (id, name, leader_id) values
  ('c1000000-0000-0000-0000-000000000001', 'Cell C1', null),
  ('c1000000-0000-0000-0000-000000000002', 'Cell C2', null);

insert into public.profiles (id, email, full_name, role, status, cell_id) values
  ('00000000-0000-0000-0000-00000000c001', 'co@t',   'Coordinator',      'coordinator', 'active',   null),
  ('00000000-0000-0000-0000-00000000c002', 'coi@t',  'Inactive coord',   'coordinator', 'inactive', null),
  ('00000000-0000-0000-0000-00000000a001', 'ad@t',   'Admin',            'admin',       'active',   null),
  ('00000000-0000-0000-0000-00000000a002', 'ai@t',   'Inactive admin',   'admin',       'inactive', null),
  ('00000000-0000-0000-0000-00000000f001', 'cl1@t',  'Cell leader C1',   'cell_leader', 'active',   'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000f002', 'clr@t',  'Role-only leader', 'cell_leader', 'active',   'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000f003', 'clx@t',  'Leader of C2',     'member',      'active',   'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000b001', 'bl1@t',  'BSC leader B1',    'member',      'active',   'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000b002', 'bl2@t',  'BSC leader B2',    'member',      'active',   'c1000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-00000000b003', 'blm@t',  'Moved BSC leader', 'member',      'active',   'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000b004', 'bli@t',  'Inactive leader',  'member',      'inactive', 'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d001', 'm1@t',   'Member 1',         'member',      'active',   'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d002', 'm2@t',   'Member 2',         'member',      'active',   'c1000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-00000000d003', 'm3@t',   'Member 3',         'member',      'active',   'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d004', 'mp@t',   'Pending member',   'member',      'pending',  'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d005', 'mr@t',   'Rejected member',  'member',      'rejected', 'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d006', 'mi@t',   'Inactive member',  'member',      'inactive', 'c1000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d007', 'mn@t',   'No cell',          'member',      'active',   null);

update public.cells set leader_id = '00000000-0000-0000-0000-00000000f001' where id = 'c1000000-0000-0000-0000-000000000001';
update public.cells set leader_id = '00000000-0000-0000-0000-00000000f003' where id = 'c1000000-0000-0000-0000-000000000002';

insert into public.bscs (id, cell_id, name, leader_id) values
  ('b1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-000000000001', 'BSC B1', '00000000-0000-0000-0000-00000000b001'),
  ('b1000000-0000-0000-0000-0000000000b2', 'c1000000-0000-0000-0000-000000000002', 'BSC B2', '00000000-0000-0000-0000-00000000b002'),
  ('b1000000-0000-0000-0000-0000000000b4', 'c1000000-0000-0000-0000-000000000001', 'BSC B4', '00000000-0000-0000-0000-00000000b003'),
  ('b1000000-0000-0000-0000-0000000000b6', 'c1000000-0000-0000-0000-000000000001', 'BSC B6', '00000000-0000-0000-0000-00000000b004'),
  ('b1000000-0000-0000-0000-0000000000be', 'c1000000-0000-0000-0000-000000000001', 'BSC Empty', null);

update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b1' where id in ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000d006');
update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000d002';
-- M3 sits in B4 (C1) so the stale leader BLM has a real roster to (wrongly) see; D1 later moves M3 to B1.
update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b4' where id = '00000000-0000-0000-0000-00000000d003';
-- BL1M's profile moves to C2 after leading B4 in C1: stale leadership (invariant I3 violated on purpose).
update public.profiles set cell_id = 'c1000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-00000000b003';

-- Enforce the real guards from here on, including for replica-mode sessions.
alter table public.profiles enable always trigger profiles_guard_privileged_columns;
alter table public.profiles enable always trigger profiles_guard_bsc_assignment;
alter table public.bscs enable always trigger bscs_guard_leader_eligibility;
alter table public.bscs enable always trigger bscs_guard_delete_empty;

-- ─── Ids used below ─────────────────────────────────────────────────────────────────────────────────────────────────
-- C1 = c1000000-…-000000000001   C2 = c1000000-…-000000000002
-- CL1 f001  CLR f002  CLX f003  BL1 b001  BL2 b002  BLM b003  BLI b004  M1 d001  M2 d002  M3 d003  MP d004  MR d005
-- MI d006  MN d007  CO c001  COI c002  AD a001  AI a002  B1 b1…b1  B2 b1…b2  B4 b1…b4  B6 b1…b6  BE b1…be

-- ═════════ A. Cell leadership follows cells.leader_id (D1, D5) ═══════════════════════════════════════════════════════
select rls_test.expect_count('A1 cell leader CL1 sees the other C1 profiles that are neither pending nor rejected (7; pending MP d004 and rejected MR d005 hidden by migration 102)', '00000000-0000-0000-0000-00000000f001',
  $q$select id from public.profiles where cell_id = 'c1000000-0000-0000-0000-000000000001' and id <> '00000000-0000-0000-0000-00000000f001'$q$, 7);
select rls_test.expect_count('A2 ROLE-ONLY leader CLR sees no other C1 profiles (not cells.leader_id)', '00000000-0000-0000-0000-00000000f002',
  $q$select id from public.profiles where cell_id = 'c1000000-0000-0000-0000-000000000001' and id <> '00000000-0000-0000-0000-00000000f002'$q$, 0);
select rls_test.expect_count('A3 CLX (leads C2, profile in C1) sees C2 profiles (3)', '00000000-0000-0000-0000-00000000f003',
  $q$select id from public.profiles where cell_id = 'c1000000-0000-0000-0000-000000000002'$q$, 3);
select rls_test.expect_count('A4 CLX (leads C2, profile in C1) sees no other C1 profiles', '00000000-0000-0000-0000-00000000f003',
  $q$select id from public.profiles where cell_id = 'c1000000-0000-0000-0000-000000000001' and id <> '00000000-0000-0000-0000-00000000f003'$q$, 0);
select rls_test.expect_count('A5 cell leader CL1 sees no C2 profiles (other cell)', '00000000-0000-0000-0000-00000000f001',
  $q$select id from public.profiles where cell_id = 'c1000000-0000-0000-0000-000000000002'$q$, 0);
select rls_test.expect_count('A6 role-only leader CLR cannot read a C1 member row by id (M1)', '00000000-0000-0000-0000-00000000f002',
  $q$select id from public.profiles where id = '00000000-0000-0000-0000-00000000d001'$q$, 0);
select rls_test.expect_error('A7 role-only leader CLR cannot change own role to coordinator', '00000000-0000-0000-0000-00000000f002',
  $q$update public.profiles set role = 'coordinator' where id = '00000000-0000-0000-0000-00000000f002'$q$, '42501', '%Not authorised to change role%');
select rls_test.expect_error('A8 role-only leader CLR cannot create a BSC in C1 (not cells.leader_id)', '00000000-0000-0000-0000-00000000f002',
  $q$insert into public.bscs (cell_id, name) values ('c1000000-0000-0000-0000-000000000001', 'Rogue')$q$, '42501', '%row-level security%');

-- ═════════ B. Read-side BSC scope (D4, D2, invariants I3/I4) ══════════════════════════════════════════════════════════
select rls_test.expect_count('B1 BSC leader BL1 sees only active B1 members (M1)', '00000000-0000-0000-0000-00000000b001',
  'select id from public.bsc_members_visible()', 1);
select rls_test.expect_count('B2 BSC leader BL2 sees only B2 members (M2)', '00000000-0000-0000-0000-00000000b002',
  'select id from public.bsc_members_visible()', 1);
select rls_test.expect_count('B3 STALE leader BLM (leads B4 from C1, now in C2) sees no roster (M3 is in B4)', '00000000-0000-0000-0000-00000000b003',
  'select id from public.bsc_members_visible()', 0);
select rls_test.expect_count('B4 STALE leader BLM is not a BSC leader of B4', '00000000-0000-0000-0000-00000000b003',
  'select 1 where public.is_bsc_leader_of(''b1000000-0000-0000-0000-0000000000b4'')', 0);
select rls_test.expect_count('B5 INACTIVE leader BLI (legacy row) sees no roster', '00000000-0000-0000-0000-00000000b004',
  'select id from public.bsc_members_visible()', 0);
select rls_test.expect_count('B6 cell leader CL1 sees the active C1 BSC members (M1 in B1, M3 in B4)', '00000000-0000-0000-0000-00000000f001',
  'select id from public.bsc_members_visible()', 2);
select rls_test.expect_count('B7 rejected member MR sees no BSCs', '00000000-0000-0000-0000-00000000d005',
  'select id from public.bscs', 0);
select rls_test.expect_count('B8 pending member MP sees no BSCs', '00000000-0000-0000-0000-00000000d004',
  'select id from public.bscs', 0);
select rls_test.expect_count('B9 member MN sees no roster', '00000000-0000-0000-0000-00000000d007',
  'select id from public.bsc_members_visible()', 0);
select rls_test.expect_error('B10 BSC leader BL1 cannot move own profile to another cell', '00000000-0000-0000-0000-00000000b001',
  $q$update public.profiles set cell_id = 'c1000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-00000000b001'$q$, '42501', '%permission denied for table profiles%');
select rls_test.expect_rows('B11 BSC leader BL1 cannot rename a BSC (zero rows)', '00000000-0000-0000-0000-00000000b001',
  $q$update public.bscs set name = 'x' where id = 'b1000000-0000-0000-0000-0000000000b1'$q$, 0);

-- ═════════ C. BSC leader eligibility and cell-leader BSC management (D2, D6, approved decision 2) ═══════════════════════
select rls_test.expect_rows('C1 cell leader CL1 creates a BSC in C1 with an active C1 leader (M3)', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.bscs (cell_id, name, leader_id) values ('c1000000-0000-0000-0000-000000000001', 'New B', '00000000-0000-0000-0000-00000000d003')$q$, 1);
select rls_test.expect_error('C2 cell leader CL1 cannot set an INACTIVE leader (BLI)', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.bscs (cell_id, name, leader_id) values ('c1000000-0000-0000-0000-000000000001', 'Bad', '00000000-0000-0000-0000-00000000b004')$q$, 'P0001', '%active member of the BSC%');
select rls_test.expect_error('C3 cell leader CL1 cannot set a PENDING leader (MP)', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.bscs (cell_id, name, leader_id) values ('c1000000-0000-0000-0000-000000000001', 'Bad', '00000000-0000-0000-0000-00000000d004')$q$, 'P0001', '%active member of the BSC%');
select rls_test.expect_error('C4 cell leader CL1 cannot set a REJECTED leader (MR)', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.bscs (cell_id, name, leader_id) values ('c1000000-0000-0000-0000-000000000001', 'Bad', '00000000-0000-0000-0000-00000000d005')$q$, 'P0001', '%active member of the BSC%');
select rls_test.expect_error('C5 cell leader CL1 cannot set a leader from another cell (M2, C2)', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.bscs (cell_id, name, leader_id) values ('c1000000-0000-0000-0000-000000000001', 'Bad', '00000000-0000-0000-0000-00000000d002')$q$, 'P0001', '%active member of the BSC%');
select rls_test.expect_error('C6 cell leader CL1 cannot create a BSC in C2 (not led)', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.bscs (cell_id, name) values ('c1000000-0000-0000-0000-000000000002', 'Cross cell')$q$, '42501', '%row-level security%');
select rls_test.expect_rows('C7 cell leader CL1 cannot re-point BSC B2 in C2 (zero rows)', '00000000-0000-0000-0000-00000000f001',
  $q$update public.bscs set leader_id = '00000000-0000-0000-0000-00000000d003' where id = 'b1000000-0000-0000-0000-0000000000b2'$q$, 0);
select rls_test.expect_error('C8 cell leader CL1 cannot move a led BSC into C2 (new cell must be led)', '00000000-0000-0000-0000-00000000f001',
  $q$update public.bscs set cell_id = 'c1000000-0000-0000-0000-000000000002' where id = 'b1000000-0000-0000-0000-0000000000be'$q$, '42501', '%row-level security%');
select rls_test.expect_rows('C9 CLX (leads C2) creates a BSC in C2 with an active C2 leader (M2)', '00000000-0000-0000-0000-00000000f003',
  $q$insert into public.bscs (cell_id, name, leader_id) values ('c1000000-0000-0000-0000-000000000002', 'C2 extra', '00000000-0000-0000-0000-00000000d002')$q$, 1);
select rls_test.expect_error('C10 member MN cannot create a BSC', '00000000-0000-0000-0000-00000000d007',
  $q$insert into public.bscs (cell_id, name) values ('c1000000-0000-0000-0000-000000000001', 'Nope')$q$, '42501', '%row-level security%');
select rls_test.expect_error('C11 inactive coordinator COI cannot create a BSC', '00000000-0000-0000-0000-00000000c002',
  $q$insert into public.bscs (cell_id, name) values ('c1000000-0000-0000-0000-000000000001', 'Nope')$q$, '42501', '%row-level security%');
select rls_test.expect_rows('C12 admin AD creates a BSC in C2 with an active C2 leader (M2)', '00000000-0000-0000-0000-00000000a001',
  $q$insert into public.bscs (cell_id, name, leader_id) values ('c1000000-0000-0000-0000-000000000002', 'Admin B', '00000000-0000-0000-0000-00000000d002')$q$, 1);
select rls_test.expect_error('C13 admin AD cannot create a BSC whose leader is in another cell', '00000000-0000-0000-0000-00000000a001',
  $q$insert into public.bscs (cell_id, name, leader_id) values ('c1000000-0000-0000-0000-000000000001', 'Bad', '00000000-0000-0000-0000-00000000d002')$q$, 'P0001', '%active member of the BSC%');
select rls_test.expect_rows('C14 cell leader CL1 cannot re-point the leader of BSC B2 in C2 by update (zero rows)', '00000000-0000-0000-0000-00000000f001',
  $q$update public.bscs set leader_id = '00000000-0000-0000-0000-00000000d001' where id = 'b1000000-0000-0000-0000-0000000000b2'$q$, 0);

-- ═════════ D. Admin BSC assignment through the audited RPC (D3) ═══════════════════════════════════════════════════════
select rls_test.expect_count('D1 admin AD assigns M3 (C1) to B1 through the RPC (1 row)', '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d003', 'b1000000-0000-0000-0000-0000000000b1')$q$, 1);
select rls_test.expect_count('D2 coordinator CO assigns M1 to B1 through the RPC (1 row)', '00000000-0000-0000-0000-00000000c001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d001', 'b1000000-0000-0000-0000-0000000000b1')$q$, 1);
select rls_test.expect_error('D3 admin AD cannot assign M2 (C2) to a C1 BSC (cell mismatch)', '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d002', 'b1000000-0000-0000-0000-0000000000b1')$q$, 'P0001', '%current cell%');
select rls_test.expect_error('D4 admin AD cannot assign a PENDING member', '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d004', 'b1000000-0000-0000-0000-0000000000b1')$q$, 'P0001', '%Only active%');
select rls_test.expect_error('D5 admin AD cannot assign a REJECTED member', '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d005', 'b1000000-0000-0000-0000-0000000000b1')$q$, 'P0001', '%Only active%');
select rls_test.expect_error('D6 admin AD: unknown member id is a zero-row failure, not success', '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-0000000000ff', 'b1000000-0000-0000-0000-0000000000b1')$q$, 'P0002', '%Member not found%');
select rls_test.expect_error('D7 cell leader CL1 cannot use the RPC (roster is staff-only)', '00000000-0000-0000-0000-00000000f001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d003', 'b1000000-0000-0000-0000-0000000000b1')$q$, '42501', '%Not authorised%');
select rls_test.expect_error('D8 BSC leader BL1 cannot use the RPC', '00000000-0000-0000-0000-00000000b001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d003', 'b1000000-0000-0000-0000-0000000000b1')$q$, '42501', '%Not authorised%');
select rls_test.expect_error('D9 ordinary member M1 cannot assign himself to another BSC via the RPC', '00000000-0000-0000-0000-00000000d001',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d001', 'b1000000-0000-0000-0000-0000000000b2')$q$, '42501', '%Not authorised%');
select rls_test.expect_error('D10 inactive admin AI cannot use the RPC', '00000000-0000-0000-0000-00000000a002',
  $q$select * from public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d003', 'b1000000-0000-0000-0000-0000000000b1')$q$, '42501', '%Not authorised%');
select rls_test.expect_error('D11 member M1 cannot write the BSC field directly', '00000000-0000-0000-0000-00000000d001',
  $q$update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000d001'$q$, '42501', '%permission denied for table profiles%');
select rls_test.expect_error('D12 admin AD direct UPDATE of a profile BSC is refused (42501, no admin profile policy)', '00000000-0000-0000-0000-00000000a001',
  $q$update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000d002'$q$, '42501', '%permission denied for table profiles%');
select rls_test.expect_rows('D13 admin AD direct UPDATE of a profile role matches zero rows', '00000000-0000-0000-0000-00000000a001',
  $q$update public.profiles set role = 'coordinator' where id = '00000000-0000-0000-0000-00000000d003'$q$, 0);
select rls_test.expect_error('D14 admin AD direct UPDATE of a profile cell is refused (42501)', '00000000-0000-0000-0000-00000000a001',
  $q$update public.profiles set cell_id = null where id = '00000000-0000-0000-0000-00000000d003'$q$, '42501', '%permission denied for table profiles%');
select rls_test.expect_count('D15 audit: admin sees the two RPC assignments', '00000000-0000-0000-0000-00000000a001',
  'select id from public.bsc_assignment_audit', 2);
select rls_test.expect_count('D16 audit: an ordinary member sees no audit rows', '00000000-0000-0000-0000-00000000d001',
  'select id from public.bsc_assignment_audit', 0);
select rls_test.expect_error('D17 audit: a member cannot forge an audit row', '00000000-0000-0000-0000-00000000d001',
  $q$insert into public.bsc_assignment_audit (member_id, to_bsc_id, performed_by) values ('00000000-0000-0000-0000-00000000d001', 'b1000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001')$q$,
  '42501', '%permission denied%');

-- ═════════ E. Deletion of BSCs (D6) ═══════════════════════════════════════════════════════════════════════════════════
select rls_test.expect_error('E1 admin AD cannot delete a BSC that still has members (B1)', '00000000-0000-0000-0000-00000000a001',
  $q$delete from public.bscs where id = 'b1000000-0000-0000-0000-0000000000b1'$q$, 'P0001', '%still has members%');
select rls_test.expect_rows('E2 cell leader CL1 cannot delete a BSC (staff-only, zero rows)', '00000000-0000-0000-0000-00000000f001',
  $q$delete from public.bscs where id = 'b1000000-0000-0000-0000-0000000000be'$q$, 0);
select rls_test.expect_rows('E3 coordinator CO deletes an empty BSC', '00000000-0000-0000-0000-00000000c001',
  $q$delete from public.bscs where id = 'b1000000-0000-0000-0000-0000000000be'$q$, 1);

-- ═════════ F. Self-service escalation attempts (privilege escalation) ═══════════════════════════════════════════════════
select rls_test.expect_error('F1 member M1 cannot change own cell', '00000000-0000-0000-0000-00000000d001',
  $q$update public.profiles set cell_id = 'c1000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-00000000d001'$q$, '42501', '%permission denied for table profiles%');
select rls_test.expect_error('F2 member M1 cannot change another profile (pending MP) status (refused, 42501)', '00000000-0000-0000-0000-00000000d001',
  $q$update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000d004'$q$, '42501', '%permission denied for table profiles%');
select rls_test.expect_rows('F3 cell leader CL1 cannot re-point cells.leader_id (zero rows)', '00000000-0000-0000-0000-00000000f001',
  $q$update public.cells set leader_id = '00000000-0000-0000-0000-00000000f001' where id = 'c1000000-0000-0000-0000-000000000002'$q$, 0);

-- ═════════ G. Meetings in led cells only (D5, BSC meeting visibility unchanged) ══════════════════════════════════════════
select rls_test.expect_rows('G1 cell leader CL1 creates a meeting in C1', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.meetings (title, date, time, visibility, category, cell_id, created_by) values ('C1 meeting', current_date, '19:00', 'public', 'bsc', 'c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f001')$q$, 1);
select rls_test.expect_error('G2 role-only leader CLR cannot create a meeting in C1', '00000000-0000-0000-0000-00000000f002',
  $q$insert into public.meetings (title, date, time, visibility, category, cell_id, created_by) values ('x', current_date, '19:00', 'public', 'cell', 'c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f002')$q$, '42501', '%row-level security%');
select rls_test.expect_error('G3 cell leader CL1 cannot create a meeting in C2', '00000000-0000-0000-0000-00000000f001',
  $q$insert into public.meetings (title, date, time, visibility, category, cell_id, created_by) values ('x', current_date, '19:00', 'public', 'cell', 'c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000f001')$q$, '42501', '%row-level security%');
select rls_test.expect_rows('G4 CLX creates a meeting in C2 (led)', '00000000-0000-0000-0000-00000000f003',
  $q$insert into public.meetings (title, date, time, visibility, category, cell_id, created_by) values ('C2 meeting', current_date, '19:00', 'public', 'cell', 'c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000f003')$q$, 1);
select rls_test.expect_count('G5 BSC-category meetings stay public: member M3 sees the C1 BSC meeting (unchanged visibility)', '00000000-0000-0000-0000-00000000d003',
  $q$select id from public.meetings where category = 'bsc'$q$, 1);

-- ═════════ H. Regression: cell-leader profile scope after the role change ════════════════════════════════════════════════
select rls_test.expect_count('H1 coordinator CO sees every profile (unchanged)', '00000000-0000-0000-0000-00000000c001',
  'select id from public.profiles', 18);

select * from rls_test.results order by name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from rls_test.results;

rollback;
