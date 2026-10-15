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

-- ═════════ Rejected-member privacy (migration 102). Standalone fixture; every check runs as the named role. ═════════
create function rls_test.expect_anon_error(p_name text, p_sql text, p_state text) returns void language plpgsql as $fn$
declare st text := 'OK';
begin
  execute 'set local role anon';
  begin
    execute p_sql;
  exception when others then
    st := sqlstate;
  end;
  execute 'reset role';
  insert into rls_test.results values (p_name, st = p_state, 'SQLSTATE ' || st || ' (expected ' || p_state || ')');
end $fn$;

insert into public.cells (id, name) values
  ('c2000000-0000-0000-0000-000000000001', 'RJ Cell 1'),
  ('c2000000-0000-0000-0000-000000000002', 'RJ Cell 2');

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000a001', 'rj-ad@t', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000c001', 'rj-co@t', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000f001', 'rj-cl@t', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000d001', 'rj-m1@t', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000d003', 'rj-m3@t', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000d004', 'rj-mp@t', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000d005', 'rj-mr@t', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-00000000e001', 'rj-rx@t', 'authenticated', 'authenticated', now(), now());

insert into public.profiles (id, email, full_name, role, status, cell_id) values
  ('00000000-0000-0000-0000-00000000a001', 'rj-ad@t', 'RJ Admin', 'admin', 'active', null),
  ('00000000-0000-0000-0000-00000000c001', 'rj-co@t', 'RJ Coordinator', 'coordinator', 'active', null),
  ('00000000-0000-0000-0000-00000000f001', 'rj-cl@t', 'RJ Cell leader', 'cell_leader', 'active', 'c2000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d001', 'rj-m1@t', 'RJ Member 1', 'member', 'active', 'c2000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d003', 'rj-m3@t', 'RJ Member 3', 'member', 'active', 'c2000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d004', 'rj-mp@t', 'RJ Pending', 'member', 'pending', 'c2000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000d005', 'rj-mr@t', 'RJ Rejected', 'member', 'rejected', 'c2000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000e001', 'rj-rx@t', 'RJ Rejected in C2', 'member', 'rejected', 'c2000000-0000-0000-0000-000000000002');

update public.cells set leader_id = '00000000-0000-0000-0000-00000000f001' where id = 'c2000000-0000-0000-0000-000000000001';

insert into public.user_profiles (user_id, first_name, last_name) values
  ('00000000-0000-0000-0000-00000000a001', 'RJ', 'Admin'),
  ('00000000-0000-0000-0000-00000000c001', 'RJ', 'Coordinator'),
  ('00000000-0000-0000-0000-00000000f001', 'RJ', 'Leader'),
  ('00000000-0000-0000-0000-00000000d001', 'RJ', 'Member1'),
  ('00000000-0000-0000-0000-00000000d003', 'RJ', 'Member3'),
  ('00000000-0000-0000-0000-00000000d004', 'RJ', 'Pending'),
  ('00000000-0000-0000-0000-00000000d005', 'RJ', 'Rejected'),
  ('00000000-0000-0000-0000-00000000e001', 'RJ', 'RejectedC2');

-- ── profiles: ordinary member, invitee, cell leader, rejected self, staff, anonymous
select rls_test.expect_count('P1 ordinary member M3 sees only own profile', '00000000-0000-0000-0000-00000000d003', 'select id from public.profiles', 1);
select rls_test.expect_count('P2 ordinary member M3 sees no rejected profile', '00000000-0000-0000-0000-00000000d003', $q$select id from public.profiles where status = 'rejected'$q$, 0);
select rls_test.expect_count('P3 meeting invitee M1 sees no rejected profile', '00000000-0000-0000-0000-00000000d001', $q$select id from public.profiles where status = 'rejected'$q$, 0);
select rls_test.expect_count('P4 cell leader CL sees no rejected profile (C1 or C2)', '00000000-0000-0000-0000-00000000f001', $q$select id from public.profiles where status = 'rejected'$q$, 0);
select rls_test.expect_count('P5 cell leader CL sees active C1 members M1 and M3 (unchanged), and no pending', '00000000-0000-0000-0000-00000000f001',
  $q$select id from public.profiles where cell_id = 'c2000000-0000-0000-0000-000000000001' and id <> '00000000-0000-0000-0000-00000000f001'$q$, 2);
select rls_test.expect_count('P6 rejected member MR sees own profile only', '00000000-0000-0000-0000-00000000d005', 'select id from public.profiles', 1);
select rls_test.expect_count('P7 administrator AD sees both rejected profiles', '00000000-0000-0000-0000-00000000a001', $q$select id from public.profiles where status = 'rejected'$q$, 2);
select rls_test.expect_count('P8 coordinator CO sees both rejected profiles', '00000000-0000-0000-0000-00000000c001', $q$select id from public.profiles where status = 'rejected'$q$, 2);
select rls_test.expect_count('P9 coordinator CO sees every profile (8)', '00000000-0000-0000-0000-00000000c001', 'select id from public.profiles', 8);
select rls_test.expect_anon_error('P10 anonymous cannot read profiles', 'select id from public.profiles', '42501');

-- ── member_directory (security_invoker: inherits the profiles rule)
select rls_test.expect_count('D1 ordinary member M3 sees no rejected member_directory row', '00000000-0000-0000-0000-00000000d003', $q$select id from public.member_directory where status = 'rejected'$q$, 0);
select rls_test.expect_count('D2 cell leader CL sees no rejected member_directory row', '00000000-0000-0000-0000-00000000f001', $q$select id from public.member_directory where status = 'rejected'$q$, 0);
select rls_test.expect_count('D3 administrator AD sees both rejected member_directory rows', '00000000-0000-0000-0000-00000000a001', $q$select id from public.member_directory where status = 'rejected'$q$, 2);
select rls_test.expect_count('D4 coordinator CO sees both rejected member_directory rows', '00000000-0000-0000-0000-00000000c001', $q$select id from public.member_directory where status = 'rejected'$q$, 2);
select rls_test.expect_count('D5 rejected MR sees own member_directory row only', '00000000-0000-0000-0000-00000000d005', 'select id from public.member_directory', 1);
select rls_test.expect_anon_error('D6 anonymous cannot read member_directory', 'select id from public.member_directory', '42501');

-- ── user_profiles (the same leader branch, tightened)
select rls_test.expect_count('U1 cell leader CL reads no rejected MR user_profiles row', '00000000-0000-0000-0000-00000000f001', $q$select user_id from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.expect_count('U2 cell leader CL still reads active member M3 user_profiles row', '00000000-0000-0000-0000-00000000f001', $q$select user_id from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d003'$q$, 1);
select rls_test.expect_count('U3 administrator AD reads MR user_profiles row', '00000000-0000-0000-0000-00000000a001', $q$select user_id from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d005'$q$, 1);
select rls_test.expect_count('U4 coordinator CO reads MR user_profiles row', '00000000-0000-0000-0000-00000000c001', $q$select user_id from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d005'$q$, 1);
select rls_test.expect_count('U5 rejected MR reads own user_profiles row', '00000000-0000-0000-0000-00000000d005', $q$select user_id from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d005'$q$, 1);
select rls_test.expect_count('U6 ordinary member M3 reads no rejected user_profiles row', '00000000-0000-0000-0000-00000000d003', $q$select user_id from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.expect_anon_error('U7 anonymous cannot read user_profiles', 'select user_id from public.user_profiles', '42501');

-- ── Authorized staff workflow: reopen rejected -> pending, then staff and leaders see the account as pending
select rls_test.expect_count('W1 coordinator reopens rejected MR to pending (workflow RPC)', '00000000-0000-0000-0000-00000000c001',
  $q$select member_id from public.set_member_status('00000000-0000-0000-0000-00000000d005', 'pending', 'reopen for review')$q$, 1);
insert into rls_test.results select 'W2 reopened MR is pending (owner check)', (select status = 'pending' from public.profiles where id = '00000000-0000-0000-0000-00000000d005'), 'status after reopen';
select rls_test.expect_count('W3 cell leader CL does not see the reopened pending account', '00000000-0000-0000-0000-00000000f001',
  $q$select id from public.profiles where id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.expect_count('W4 administrator AD sees the reopened pending account', '00000000-0000-0000-0000-00000000a001',
  $q$select id from public.profiles where id = '00000000-0000-0000-0000-00000000d005'$q$, 1);

-- ── Records preserved: the rejected row still exists for the owner (no delete, no rewrite)
insert into rls_test.results select 'R1 rejected RX row preserved (owner check)', (select count(*) = 1 from public.profiles where id = '00000000-0000-0000-0000-00000000e001' and status = 'rejected'), 'row exists';

select * from rls_test.results order by name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from rls_test.results;

rollback;
