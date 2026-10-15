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

create or replace function rls_test.safe_count(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform rls_test.as_user(p_user);
  begin
    execute 'select count(*) from (' || p_sql || ') q' into n;
  exception when others then
    perform rls_test.as_owner();
    insert into rls_test.results values (p_name, false, 'ERROR ' || sqlstate || ': ' || left(sqlerrm, 90));
    return;
  end;
  perform rls_test.as_owner();
  insert into rls_test.results values (p_name, n = p_expected, n || ' visible (expected ' || p_expected || ')');
end $fn$;
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

-- ═════════ Phase 2 read paths (synthetic fixtures added as owner; every check runs as the named role). ═════════
-- A synthetic people row and membership row for the rejected member, and a synthetic BSC placement, so the read paths
-- have rejected data to expose. The workflow never produces a BSC placement for a rejected account; this is a test fixture.
insert into public.people (id, full_name, email) values
  ('00000000-0000-0000-0000-00000000d005', 'RJ Rejected', 'rj-mr@t'),
  ('00000000-0000-0000-0000-00000000d003', 'RJ Member 3', 'rj-m3@t');
insert into public.memberships (person_id, role, status, cell_id) values
  ('00000000-0000-0000-0000-00000000d005', 'member', 'rejected', 'c2000000-0000-0000-0000-000000000001');
insert into public.bscs (id, cell_id, name, leader_id) values
  ('b2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'RJ BSC', '00000000-0000-0000-0000-00000000f001');
update public.profiles set bsc_id = 'b2000000-0000-0000-0000-000000000001', person_id = '00000000-0000-0000-0000-00000000d005' where id = '00000000-0000-0000-0000-00000000d005';
update public.profiles set person_id = '00000000-0000-0000-0000-00000000d003' where id = '00000000-0000-0000-0000-00000000d003';

-- ── memberships (memberships_read: core admin or own person row)
select rls_test.safe_count('M1 ordinary member M3 reads no rejected membership row', '00000000-0000-0000-0000-00000000d003', $q$select id from public.memberships where person_id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.safe_count('M2 cell leader CL reads no rejected membership row', '00000000-0000-0000-0000-00000000f001', $q$select id from public.memberships where person_id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.safe_count('M3 rejected member MR reads own membership row', '00000000-0000-0000-0000-00000000d005', $q$select id from public.memberships where person_id = '00000000-0000-0000-0000-00000000d005'$q$, 1);
select rls_test.safe_count('M4 administrator AD reads the rejected membership row', '00000000-0000-0000-0000-00000000a001', $q$select id from public.memberships where person_id = '00000000-0000-0000-0000-00000000d005'$q$, 1);

-- ── people (095: a person linked to a rejected profile is staff-only)
select rls_test.safe_count('PE1 cell leader CL reads no rejected people row', '00000000-0000-0000-0000-00000000f001', $q$select id from public.people where id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.safe_count('PE2 ordinary member M3 reads no rejected people row', '00000000-0000-0000-0000-00000000d003', $q$select id from public.people where id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.safe_count('PE3 administrator AD reads the rejected people row', '00000000-0000-0000-0000-00000000a001', $q$select id from public.people where id = '00000000-0000-0000-0000-00000000d005'$q$, 1);

-- ── bsc_members_visible (roster of BSC members for the caller)
select rls_test.safe_count('B1 cell leader CL (leads the BSC) sees no rejected member on the roster', '00000000-0000-0000-0000-00000000f001', $q$select id from public.bsc_members_visible() where id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.safe_count('B2 ordinary member M3 sees no rejected member on any roster', '00000000-0000-0000-0000-00000000d003', $q$select id from public.bsc_members_visible() where id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.safe_count('B3 administrator AD BSC roster excludes the rejected member (existing rule, unchanged by 102)', '00000000-0000-0000-0000-00000000a001', $q$select id from public.bsc_members_visible() where id = '00000000-0000-0000-0000-00000000d005'$q$, 0);

-- ── cell_leader_pending_roster (pending applicants for placement; rejected accounts are not pending)
select rls_test.safe_count('R1 cell leader CL pending roster does not list the rejected member', '00000000-0000-0000-0000-00000000f001', $q$select id from public.cell_leader_pending_roster() where id = '00000000-0000-0000-0000-00000000d005'$q$, 0);
select rls_test.safe_count('R2 cell leader CL pending roster still lists the pending applicant (unchanged)', '00000000-0000-0000-0000-00000000f001', $q$select id from public.cell_leader_pending_roster() where id = '00000000-0000-0000-0000-00000000d004'$q$, 1);

-- ── search and export paths
select rls_test.expect_error('S1 ordinary member M3 cannot call find_person_by_email (refused)', '00000000-0000-0000-0000-00000000d003', $q$select * from public.find_person_by_email('rj-mr@t')$q$, '42501', '%');
select rls_test.safe_count('S2 cell leader CL profile search by name finds no rejected member', '00000000-0000-0000-0000-00000000f001', $q$select id from public.profiles where full_name ilike 'RJ Rejected%'$q$, 0);
select rls_test.safe_count('S3 cell leader CL member_directory search finds no rejected member', '00000000-0000-0000-0000-00000000f001', $q$select id from public.member_directory where full_name ilike 'RJ Rejected%'$q$, 0);
select rls_test.expect_error('S4 ordinary member M3 cannot export members (refused, 42501)', '00000000-0000-0000-0000-00000000d003', $q$select id from public.export_members_authorized('all')$q$, '42501', '%');
select rls_test.expect_error('S5 cell leader CL cannot export members (refused, 42501)', '00000000-0000-0000-0000-00000000f001', $q$select id from public.export_members_authorized('all')$q$, '42501', '%');
select rls_test.safe_count('S6 administrator AD export lists the rejected member', '00000000-0000-0000-0000-00000000a001', $q$select id from public.export_members_authorized('all') where id = '00000000-0000-0000-0000-00000000d005'$q$, 1);

-- ── active-member counts (what each role can count)
select rls_test.safe_count('C1 ordinary member M3 counts only own active profile', '00000000-0000-0000-0000-00000000d003', $q$select id from public.profiles where status = 'active'$q$, 1);
select rls_test.safe_count('C2 cell leader CL counts no rejected profile in any active-count query', '00000000-0000-0000-0000-00000000f001', $q$select id from public.profiles where status = 'rejected'$q$, 0);
select rls_test.safe_count('C3 cell leader CL active C1 profiles = self, M1, M3, and the BSC-led nothing else', '00000000-0000-0000-0000-00000000f001', $q$select id from public.profiles where status = 'active' and cell_id = 'c2000000-0000-0000-0000-000000000001'$q$, 3);

-- ── staff identity access stays intact
select rls_test.expect_error('I1 cell leader CL cannot call get_person_identity for the rejected member', '00000000-0000-0000-0000-00000000f001', $q$select * from public.get_person_identity('00000000-0000-0000-0000-00000000d005', 'review')$q$, '42501', '%');

select * from rls_test.results order by name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from rls_test.results;

rollback;
