-- identity_link_103_suite.sql
--
-- Executable SQL suite for migration 103 as reconciled at 440ebd8: the single staff queue list_account_link_queue(p_reason),
-- the approval gate (any pending profile with person_id NULL is refused), the pending-email-change guard, and the
-- append-only approval audit. Run on a database that has replayed migrations 000-103 from empty, against the real GoTrue
-- auth schema (auth.users must carry email_change, email_change_token_new and email_confirmed_at). Local disposable
-- stacks only. Never run it on a hosted or Preview database.
--
-- Every check runs as an authenticated session (set local role authenticated + request.jwt.claim.sub), so RLS and the
-- SECURITY DEFINER helpers are evaluated as an API caller would hit them. Denials are checked by SQLSTATE AND message.
-- Fixtures are inserted with session_replication_role = replica, so the signup trigger does not run; the profile rows
-- are written explicitly, as in the 102 suites. Everything is inside one transaction that is rolled back.
--
-- Output: the final line is "<checks>|<failed>", which the workflow reads. The workflow fails unless the count matches
-- its pinned EXPECTED_IDENTITY_CHECKS and the failed count is 0.

begin;
set local session_replication_role = replica;

create schema id103_test;
create table id103_test.results (name text, ok boolean, detail text);
grant usage on schema id103_test to authenticated, anon;

create function id103_test.as_user(p_user uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
end $fn$;

create function id103_test.as_owner() returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $fn$;

-- Runs p_sql as p_user and expects SQLSTATE p_code. A success is a failure of the check.
create function id103_test.expect_error(p_name text, p_user uuid, p_code text, p_sql text) returns void language plpgsql as $fn$
declare v_code text; v_msg text;
begin
  perform id103_test.as_user(p_user);
  begin
    execute p_sql;
    perform id103_test.as_owner();
    insert into id103_test.results values (p_name, false, 'no error raised');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_code := sqlstate;
    perform id103_test.as_owner();
    insert into id103_test.results values (p_name, v_code = p_code, v_code || ': ' || v_msg);
  end;
end $fn$;

-- Runs p_sql as p_user and expects it to succeed.
create function id103_test.expect_ok(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $fn$
declare v_msg text;
begin
  perform id103_test.as_user(p_user);
  begin
    execute p_sql;
    perform id103_test.as_owner();
    insert into id103_test.results values (p_name, true, 'ok');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform id103_test.as_owner();
    insert into id103_test.results values (p_name, false, v_msg);
  end;
end $fn$;

-- ── Fixtures (as owner) ───────────────────────────────────────────────────────────────────────────────────────────────
--   a001 administrator (active)
--   b001 pending, unlinked, confirmed, email matches person c001                 -> queue, link and approve
--   b002 pending, unlinked, confirmed, PENDING EMAIL CHANGE, email matches c002  -> queue, refused until cleared
--   b003 pending, unlinked, UNCONFIRMED email, email matches c003                -> not in queue, never linkable
--   b004 pending, linked to c004 at signup (new applicant)                       -> approvable, not in queue

insert into public.people (id, full_name, email) values
  ('00000000-0000-0000-0000-00000000c001', 'Link Person',   'link@x.org'),
  ('00000000-0000-0000-0000-00000000c002', 'Change Person', 'change@x.org'),
  ('00000000-0000-0000-0000-00000000c003', 'Unc Person',    'unc@x.org'),
  ('00000000-0000-0000-0000-00000000c004', 'New Member',    'new@y.org');

insert into auth.users (id, aud, role, email, email_confirmed_at, email_change, email_change_token_new) values
  ('00000000-0000-0000-0000-00000000a001', 'authenticated', 'authenticated', 'admin@x.org',  now(), null, null),
  ('00000000-0000-0000-0000-00000000b001', 'authenticated', 'authenticated', 'link@x.org',   now(), null, null),
  ('00000000-0000-0000-0000-00000000b002', 'authenticated', 'authenticated', 'change@x.org', now(), 'changed-to@other.org', 'tok'),
  ('00000000-0000-0000-0000-00000000b003', 'authenticated', 'authenticated', 'unc@x.org',    null, null, null),
  ('00000000-0000-0000-0000-00000000b004', 'authenticated', 'authenticated', 'new@y.org',    now(), null, null);

insert into public.profiles (id, email, full_name, role, status, person_id) values
  ('00000000-0000-0000-0000-00000000a001', 'admin@x.org',  'Admin',         'admin',  'active',  null),
  ('00000000-0000-0000-0000-00000000b001', 'link@x.org',   'Link Member',   'member', 'pending', null),
  ('00000000-0000-0000-0000-00000000b002', 'change@x.org', 'Change Member', 'member', 'pending', null),
  ('00000000-0000-0000-0000-00000000b003', 'unc@x.org',    'Unc Member',    'member', 'pending', null),
  ('00000000-0000-0000-0000-00000000b004', 'new@y.org',    'New Member',    'member', 'pending', '00000000-0000-0000-0000-00000000c004');

-- Fixtures are in place. From here every check runs with ordinary triggers ENABLED (session_replication_role = origin),
-- so the append-only audit triggers and the profile guards are exercised for real. In replica mode they are skipped.
set local session_replication_role = origin;

-- Owner-level expectation: runs p_sql as the owner and expects SQLSTATE p_code.
create function id103_test.expect_owner_error(p_name text, p_code text, p_sql text) returns void language plpgsql as $fn$
declare v_code text; v_msg text;
begin
  perform id103_test.as_owner();
  begin
    execute p_sql;
    insert into id103_test.results values (p_name, false, 'no error raised');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_code := sqlstate;
    insert into id103_test.results values (p_name, v_code = p_code, v_code || ': ' || v_msg);
  end;
end $fn$;

-- Snapshot of the staff queue, written as an administrator (the queue is staff-only).
create table id103_test.queue_snap (
  profile_id uuid, display_name text, created_at timestamptz, person_id uuid, person_name text
);
grant select, insert on id103_test.queue_snap to authenticated;

-- Audit row count captured before the refused calls, to prove a refusal writes nothing.
create table id103_test.marks (k text primary key, n bigint);

-- ── Queue (staff only, reason-gated, audited) ─────────────────────────────────────────────────────────────────────────
select id103_test.expect_ok('Q1 administrator reads the queue with a valid reason',
  '00000000-0000-0000-0000-00000000a001',
  $q$insert into id103_test.queue_snap select * from public.list_account_link_queue('Desk check of applicant identity')$q$);

insert into id103_test.results
  select 'Q2 queue lists exactly the two confirmed, pending, unlinked accounts (not the unconfirmed one, not the linked one)',
         (select count(*) = 2 from id103_test.queue_snap)
           and exists (select 1 from id103_test.queue_snap where profile_id = '00000000-0000-0000-0000-00000000b001')
           and exists (select 1 from id103_test.queue_snap where profile_id = '00000000-0000-0000-0000-00000000b002')
           and not exists (select 1 from id103_test.queue_snap where profile_id in
                 ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-00000000b004', '00000000-0000-0000-0000-00000000a001')),
         'rows';
insert into id103_test.results
  select 'Q3 each queue row carries the exact-match candidate id and name',
         exists (select 1 from id103_test.queue_snap where profile_id = '00000000-0000-0000-0000-00000000b001'
                   and person_id = '00000000-0000-0000-0000-00000000c001' and person_name = 'Link Person')
         and exists (select 1 from id103_test.queue_snap where profile_id = '00000000-0000-0000-0000-00000000b002'
                   and person_id = '00000000-0000-0000-0000-00000000c002' and person_name = 'Change Person'),
         'candidates';
insert into id103_test.results
  select 'Q4 the queue returns no email field (return type has no column named like email)',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'list_account_link_queue'
                        and pg_get_function_result(p.oid) ilike '%email%'),
         'signature';
insert into id103_test.results
  select 'Q5 a queue read writes exactly one account_link audit row, with the nil queue target',
         (select count(*) = 1 from public.identity_read_audit
           where target_kind = 'account_link' and target_id = '00000000-0000-0000-0000-000000000000'
             and actor_id = '00000000-0000-0000-0000-00000000a001'),
         'audit';

insert into id103_test.marks select 'before_refused_queue', count(*) from public.identity_read_audit;
select id103_test.expect_error('Q6 a pending member cannot read the queue (42501)',
  '00000000-0000-0000-0000-00000000b001', '42501',
  $q$select * from public.list_account_link_queue('Desk check of applicant identity')$q$);
select id103_test.expect_error('Q7 a queue call with a short reason is refused (22023)',
  '00000000-0000-0000-0000-00000000a001', '22023',
  $q$select * from public.list_account_link_queue('x')$q$);
insert into id103_test.results
  select 'Q8 refused queue calls write no audit row',
         (select count(*) from public.identity_read_audit) = (select n from id103_test.marks where k = 'before_refused_queue'),
         'audit count unchanged by the refusals';
insert into id103_test.results
  select 'Q9 anon has no execute right on the queue',
         not has_function_privilege('anon', 'public.list_account_link_queue(text)', 'execute'),
         'catalog';

-- ── Linking refusals ──────────────────────────────────────────────────────────────────────────────────────────────────
select id103_test.expect_error('L1 link refuses an account with a pending email change',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000c002','Matched by staff review')$q$);
select id103_test.expect_error('L2 link refuses an unconfirmed email',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-00000000c003','Matched by staff review')$q$);
select id103_test.expect_error('L3 link refuses a short reason (22023)',
  '00000000-0000-0000-0000-00000000a001', '22023',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000c001','x')$q$);
select id103_test.expect_error('L4 a pending member cannot link (42501)',
  '00000000-0000-0000-0000-00000000b001', '42501',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000c002','Matched by staff review')$q$);
select id103_test.expect_error('L5 link refuses a person whose email does not match the confirmed account (42501)',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000c002','Matched by staff review')$q$);
select id103_test.expect_error('L6 link refuses a person who already has an account (P0001)',
  '00000000-0000-0000-0000-00000000a001', 'P0001',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000c004','Matched by staff review')$q$);
select id103_test.expect_error('L7 link refuses an account that is already linked (P0001)',
  '00000000-0000-0000-0000-00000000a001', 'P0001',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b004','00000000-0000-0000-0000-00000000c004','Matched by staff review')$q$);

-- ── Approval gate before linking ──────────────────────────────────────────────────────────────────────────────────────
select id103_test.expect_error('A1 approval refused for an unlinked account whose email matches a person',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b001')$q$);
select id103_test.expect_error('A2 approval refused for an unlinked, unconfirmed account (person_id NULL rule)',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b003')$q$);
select id103_test.expect_error('A3 a pending member cannot approve (42501)',
  '00000000-0000-0000-0000-00000000b002', '42501',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b003')$q$);

-- ── Authorised linking and approval ───────────────────────────────────────────────────────────────────────────────────
-- Clear the pending change as GoTrue does on confirm or cancel, then link and approve.
update auth.users set email_change = null, email_change_token_new = null where id = '00000000-0000-0000-0000-00000000b002';

select id103_test.expect_ok('A4 link succeeds once the pending change is cleared',
  '00000000-0000-0000-0000-00000000a001',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000c002','Matched by staff review')$q$);
select id103_test.expect_ok('A5 link succeeds for a confirmed, matching account',
  '00000000-0000-0000-0000-00000000a001',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000c001','Confirmed by staff review')$q$);
insert into id103_test.results
  select 'A6 each authorised link wrote one attach row in profile_link_audit',
         (select count(*) = 2 from public.profile_link_audit where action = 'attach'
           and profile_id in ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b002')),
         'link audit';
select id103_test.expect_ok('A7 approval succeeds after authorised linking',
  '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b001')$q$);
insert into id103_test.results
  select 'A8 the approved account is active',
         (select status = 'active' from public.profiles where id = '00000000-0000-0000-0000-00000000b001'),
         'status';

-- Normal approval of a new member linked at signup still works, and a repeat is a no-op.
select id103_test.expect_ok('A9 new-member approval (linked at signup) succeeds',
  '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b004')$q$);
select id103_test.expect_ok('A10 repeat approval is accepted and changes nothing',
  '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b004')$q$);
insert into id103_test.results
  select 'A11 each activation wrote exactly one approval audit row (two in total)',
         (select count(*) = 2 from public.profile_approval_audit),
         'approval audit';
insert into id103_test.results
  select 'A12 approved and linked accounts no longer meet the queue criteria (pending and unlinked)',
         (select count(*) = 0 from public.profiles pr
           where pr.id in ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b002')
             and pr.status = 'pending' and pr.person_id is null),
         'queue criteria';

-- ── Append-only approval audit: client and owner writes refused ───────────────────────────────────────────────────────
select id103_test.expect_error('T1 client cannot insert an approval audit row (42501)',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$insert into public.profile_approval_audit (profile_id, actor_id, action) values ('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-00000000a001','approve')$q$);
select id103_test.expect_error('T2 client cannot update the approval audit (42501)',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$update public.profile_approval_audit set action = 'approve'$q$);
select id103_test.expect_error('T3 client cannot delete from the approval audit (42501)',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$delete from public.profile_approval_audit$q$);
select id103_test.expect_error('T4 client cannot truncate the approval audit (42501)',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$truncate public.profile_approval_audit$q$);
select id103_test.expect_owner_error('T5 owner update is refused by the append-only trigger', '42501',
  $q$update public.profile_approval_audit set action = 'approve'$q$);
select id103_test.expect_owner_error('T6 owner delete is refused by the append-only trigger', '42501',
  $q$delete from public.profile_approval_audit$q$);
select id103_test.expect_owner_error('T7 owner truncate is refused by the statement-level trigger', '42501',
  $q$truncate public.profile_approval_audit$q$);
insert into id103_test.results
  select 'T8 approval audit rows survive every refused operation',
         (select count(*) = 2 from public.profile_approval_audit),
         'rows';

-- ── Candidate reveal: staff only, reason-gated, audited ───────────────────────────────────────────────────────────────
select id103_test.expect_ok('R1 staff reveal with a reason is allowed',
  '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.get_person_identity('00000000-0000-0000-0000-00000000c001', 'Confirmed by staff review')$q$);
select id103_test.expect_error('R2 a pending member cannot reveal a person (42501)',
  '00000000-0000-0000-0000-00000000b001', '42501',
  $q$select * from public.get_person_identity('00000000-0000-0000-0000-00000000c001', 'Confirmed by staff review')$q$);
insert into id103_test.results
  select 'R3 the staff reveal is audited',
         (select count(*) >= 1 from public.identity_read_audit where target_id = '00000000-0000-0000-0000-00000000c001'),
         'audit';

-- Result: "<checks>|<failed>" on the last line, read by the workflow.
select count(*) || '|' || count(*) filter (where not ok) from id103_test.results;

rollback;
