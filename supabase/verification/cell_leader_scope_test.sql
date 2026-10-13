-- cell_leader_scope_test.sql
--
-- Real-schema regression tests for migration 048: a cell leader's assigned cell is cells.leader_id, not profiles.cell_id.
-- Covers both defect directions:
--   under-grant: a leader assigned through cells.leader_id who has no profile cell must see that cell's leadership prayers;
--   over-grant : a leader whose profile points at a cell that is assigned to someone else must see nothing from it.
-- Also covers the author-active rule, private prayers, staff access, and profile visibility (which uses the same helper).
-- Runs on a database replayed from empty through 048. No stand-ins. Everything rolls back.
--
--   docker exec -i <db container> psql -U postgres -v ON_ERROR_STOP=1 < supabase/verification/cell_leader_scope_test.sql

begin;
set local session_replication_role = replica;  -- fixtures only

create schema cls_test;
grant usage on schema cls_test to authenticated, anon;
create table cls_test.results (name text, ok boolean, detail text);

-- ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Cells: C1 led by L1 (X: no profile cell) | C2 led by L2 (assigned, profile cell C2) | C3 led by LP (pending)
--        C4 led by LI (inactive) | C5 led by LM (role member, active)
-- Over-grant actor LY: profile cell C2, but C2 is led by L2 and LY leads nothing.
insert into public.cells (id, name, leader_id) values
  ('c5000000-0000-0000-0000-0000000000c1', 'C1', '00000000-0000-0000-0000-00000000c001'),
  ('c5000000-0000-0000-0000-0000000000c2', 'C2', '00000000-0000-0000-0000-00000000c002'),
  ('c5000000-0000-0000-0000-0000000000c3', 'C3', '00000000-0000-0000-0000-00000000c003'),
  ('c5000000-0000-0000-0000-0000000000c4', 'C4', '00000000-0000-0000-0000-00000000c004'),
  ('c5000000-0000-0000-0000-0000000000c5', 'C5', '00000000-0000-0000-0000-00000000c005');

insert into public.profiles (id, email, full_name, role, status, cell_id) values
  ('00000000-0000-0000-0000-00000000c001', 'l1@t', 'L1 assigned to C1, no profile cell', 'cell_leader', 'active', null),
  ('00000000-0000-0000-0000-00000000c002', 'l2@t', 'L2 assigned to C2', 'cell_leader', 'active', 'c5000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-00000000c003', 'lp@t', 'LP pending leader of C3', 'cell_leader', 'pending', 'c5000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-00000000c004', 'li@t', 'LI inactive leader of C4', 'cell_leader', 'inactive', 'c5000000-0000-0000-0000-0000000000c4'),
  ('00000000-0000-0000-0000-00000000c005', 'lm@t', 'LM member-role leader of C5', 'member', 'active', 'c5000000-0000-0000-0000-0000000000c5'),
  ('00000000-0000-0000-0000-00000000c0ff', 'ly@t', 'LY over-grant: profile in C2, leads nothing', 'cell_leader', 'active', 'c5000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-00000000ca01', 'a1@t', 'Author in C1', 'member', 'active', 'c5000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000ca02', 'a2@t', 'Author in C2', 'member', 'active', 'c5000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-00000000ca03', 'a3@t', 'Author in C3', 'member', 'active', 'c5000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-00000000ca04', 'a4@t', 'Author in C4', 'member', 'active', 'c5000000-0000-0000-0000-0000000000c4'),
  ('00000000-0000-0000-0000-00000000ca05', 'a5@t', 'Author in C5', 'member', 'active', 'c5000000-0000-0000-0000-0000000000c5'),
  ('00000000-0000-0000-0000-00000000ca06', 'a6@t', 'Author in C1, INACTIVE', 'member', 'inactive', 'c5000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000cc01', 'co@t', 'Coordinator active', 'coordinator', 'active', null),
  ('00000000-0000-0000-0000-00000000cc02', 'coi@t', 'Coordinator inactive', 'coordinator', 'inactive', null);

-- Leadership prayers by an active author in each cell, plus one by an inactive author in C1, one private, one shared.
insert into public.prayer_requests (id, content, author_id, author_name, visibility) values
  ('c6000000-0000-0000-0000-0000000000f1', 'P1 leadership C1', '00000000-0000-0000-0000-00000000ca01', 'A1', 'leadership'),
  ('c6000000-0000-0000-0000-0000000000f2', 'P2 leadership C2', '00000000-0000-0000-0000-00000000ca02', 'A2', 'leadership'),
  ('c6000000-0000-0000-0000-0000000000f3', 'P3 leadership C3', '00000000-0000-0000-0000-00000000ca03', 'A3', 'leadership'),
  ('c6000000-0000-0000-0000-0000000000f4', 'P4 leadership C4', '00000000-0000-0000-0000-00000000ca04', 'A4', 'leadership'),
  ('c6000000-0000-0000-0000-0000000000f5', 'P5 leadership C5', '00000000-0000-0000-0000-00000000ca05', 'A5', 'leadership'),
  ('c6000000-0000-0000-0000-0000000000f6', 'P6 leadership C1 by INACTIVE author', '00000000-0000-0000-0000-00000000ca06', 'A6', 'leadership'),
  ('c6000000-0000-0000-0000-0000000000f7', 'P7 private C1', '00000000-0000-0000-0000-00000000ca01', 'A1', 'private');

-- ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
create function cls_test.as_user(p_user uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
end $fn$;

create function cls_test.as_owner() returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $fn$;

create function cls_test.expect_count(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform cls_test.as_user(p_user);
  execute 'select count(*) from (' || p_sql || ') q' into n;
  perform cls_test.as_owner();
  insert into cls_test.results values (p_name, n = p_expected, n || ' (expected ' || p_expected || ')');
end $fn$;

create function cls_test.expect_affected(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform cls_test.as_user(p_user);
  execute 'with x as (' || p_sql || ' returning 1) select count(*) from x' into n;
  perform cls_test.as_owner();
  insert into cls_test.results values (p_name, n = p_expected, n || ' rows affected (expected ' || p_expected || ')');
end $fn$;

-- Leadership prayers visible to each leader (the leadership feed, not shared or private).
-- ─── U. Under-grant: assigned through cells.leader_id, no profile cell ──────────────────────────────────────────────
select cls_test.expect_count('U1 assigned leader L1 (no profile cell) sees own-cell leadership prayer P1',
  '00000000-0000-0000-0000-00000000c001',
  $q$select id from public.prayer_requests where visibility = 'leadership' and id = 'c6000000-0000-0000-0000-0000000000f1'$q$, 1);
select cls_test.expect_count('U2 assigned leader L2 (profile cell C2) sees own-cell leadership prayer P2',
  '00000000-0000-0000-0000-00000000c002',
  $q$select id from public.prayer_requests where visibility = 'leadership' and id = 'c6000000-0000-0000-0000-0000000000f2'$q$, 1);
select cls_test.expect_count('U3 member-role leader LM assigned to C5 sees C5 leadership prayer (role is not the test)',
  '00000000-0000-0000-0000-00000000c005',
  $q$select id from public.prayer_requests where visibility = 'leadership' and id = 'c6000000-0000-0000-0000-0000000000f5'$q$, 1);

-- ─── O. Over-grant: a profile pointing at a cell someone else leads ──────────────────────────────────────────────
select cls_test.expect_count('O1 over-grant: LY (profile in C2, not assigned) sees no C2 leadership prayer',
  '00000000-0000-0000-0000-00000000c0ff',
  $q$select id from public.prayer_requests where visibility = 'leadership' and id = 'c6000000-0000-0000-0000-0000000000f2'$q$, 0);
select cls_test.expect_count('O2 over-grant: LY sees no leadership prayers at all',
  '00000000-0000-0000-0000-00000000c0ff',
  $q$select id from public.prayer_requests where visibility = 'leadership'$q$, 0);

-- ─── X. Cross-cell isolation for assigned leaders ────────────────────────────────────────────────────────────────
select cls_test.expect_count('X1 leader L1 sees only C1 leadership prayers (P1, not P2..P5)',
  '00000000-0000-0000-0000-00000000c001',
  $q$select id from public.prayer_requests where visibility = 'leadership'$q$, 1);
select cls_test.expect_count('X2 leader L2 sees only C2 leadership prayers (P2)',
  '00000000-0000-0000-0000-00000000c002',
  $q$select id from public.prayer_requests where visibility = 'leadership'$q$, 1);

-- ─── A. Author-active rule and private prayers ──────────────────────────────────────────────────────────────────
select cls_test.expect_count('A1 leader L1 does not see the leadership prayer of an INACTIVE C1 author (P6)',
  '00000000-0000-0000-0000-00000000c001',
  $q$select id from public.prayer_requests where id = 'c6000000-0000-0000-0000-0000000000f6'$q$, 0);
select cls_test.expect_count('A2 leader L1 does not see the private prayer of a C1 author (P7)',
  '00000000-0000-0000-0000-00000000c001',
  $q$select id from public.prayer_requests where id = 'c6000000-0000-0000-0000-0000000000f7'$q$, 0);
select cls_test.expect_count('A3 the private prayer is still visible to its author (P7)',
  '00000000-0000-0000-0000-00000000ca01',
  $q$select id from public.prayer_requests where id = 'c6000000-0000-0000-0000-0000000000f7'$q$, 1);

-- ─── N. Non-assigned and unauthorised leaders ────────────────────────────────────────────────────────────────────
select cls_test.expect_count('N1 pending leader LP sees no leadership prayers (C3 assigned, but LP is pending)',
  '00000000-0000-0000-0000-00000000c003',
  $q$select id from public.prayer_requests where visibility = 'leadership'$q$, 0);
select cls_test.expect_count('N2 inactive leader LI sees no leadership prayers',
  '00000000-0000-0000-0000-00000000c004',
  $q$select id from public.prayer_requests where visibility = 'leadership'$q$, 0);
select cls_test.expect_count('N3 active member with no leadership assignment sees no leadership prayers',
  '00000000-0000-0000-0000-00000000ca05',
  $q$select id from public.prayer_requests where visibility = 'leadership' and author_id <> '00000000-0000-0000-0000-00000000ca05'$q$, 0);

-- ─── S. Staff: approved administrator and coordinator access ─────────────────────────────────────────────────────
select cls_test.expect_count('S1 active coordinator sees all active authors'' leadership prayers (P1..P5)',
  '00000000-0000-0000-0000-00000000cc01',
  $q$select id from public.prayer_requests where visibility = 'leadership'$q$, 5);
select cls_test.expect_count('S2 inactive coordinator sees no leadership prayers',
  '00000000-0000-0000-0000-00000000cc02',
  $q$select id from public.prayer_requests where visibility = 'leadership'$q$, 0);

-- ─── M. Moderation is not a leader right ──────────────────────────────────────────────────────────────────────────
select cls_test.expect_affected('M1 assigned leader L1 cannot moderate P1', '00000000-0000-0000-0000-00000000c001',
  $q$update public.prayer_requests set is_active = true where id = 'c6000000-0000-0000-0000-0000000000f1'$q$, 0);
select cls_test.expect_affected('M2 active coordinator can moderate P1', '00000000-0000-0000-0000-00000000cc01',
  $q$update public.prayer_requests set is_active = true where id = 'c6000000-0000-0000-0000-0000000000f1'$q$, 1);

-- ─── P. Profile visibility uses the same assignment rule (profiles_select_scoped) ───────────────────────────────
select cls_test.expect_count('P1 assigned leader L1 sees the profile of a C1 member (A1)',
  '00000000-0000-0000-0000-00000000c001',
  $q$select id from public.profiles where id = '00000000-0000-0000-0000-00000000ca01'$q$, 1);
select cls_test.expect_count('P2 over-grant: LY (profile in C2, not assigned) cannot see the profile of a C2 member (A2)',
  '00000000-0000-0000-0000-00000000c0ff',
  $q$select id from public.profiles where id = '00000000-0000-0000-0000-00000000ca02'$q$, 0);
select cls_test.expect_count('P3 assigned leader L2 sees the profile of a C2 member (A2)',
  '00000000-0000-0000-0000-00000000c002',
  $q$select id from public.profiles where id = '00000000-0000-0000-0000-00000000ca02'$q$, 1);

select * from cls_test.results order by name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from cls_test.results;

rollback;
