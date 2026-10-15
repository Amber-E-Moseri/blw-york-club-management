-- identity_link_103_suite.sql
--
-- Executable SQL suite for migration 103 (staff identity-linking queue, approval gate, pending-email-change guard,
-- append-only approval audit). Run on a database that has replayed migrations 000-103 from empty, against the real
-- GoTrue auth schema (auth.users must carry email_change and email_confirmed_at). Local disposable stacks only.
--
-- Every check runs as an authenticated session (set local role authenticated + request.jwt.claim.sub), so RLS and the
-- SECURITY DEFINER helpers are evaluated as an API caller would hit them. Denials are checked by SQLSTATE AND message.
-- Fixtures are inserted with session_replication_role = replica, so the signup trigger does not run; the profile rows
-- are written explicitly, as in the 102 suites. Everything is inside one transaction that is rolled back.
--
-- Output: the final line is "<checks>|<failed>" (for example "20|0"), which scripts/certify-*.sh greps for.

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

insert into public.people (id, full_name, email) values
  ('00000000-0000-0000-0000-00000000c001', 'Link Person',   'link@x.org'),
  ('00000000-0000-0000-0000-00000000c002', 'Change Person', 'change@x.org'),
  ('00000000-0000-0000-0000-00000000c003', 'Unc Person',    'unc@x.org'),
  ('00000000-0000-0000-0000-00000000c004', 'New Member',    'new@y.org');

insert into auth.users (id, aud, role, email, email_confirmed_at, email_change) values
  ('00000000-0000-0000-0000-00000000a001', 'authenticated', 'authenticated', 'admin@x.org',  now(), null),
  ('00000000-0000-0000-0000-00000000b001', 'authenticated', 'authenticated', 'link@x.org',   now(), null),
  ('00000000-0000-0000-0000-00000000b002', 'authenticated', 'authenticated', 'change@x.org', now(), 'changed-to@other.org'),
  ('00000000-0000-0000-0000-00000000b003', 'authenticated', 'authenticated', 'unc@x.org',    null, null),
  ('00000000-0000-0000-0000-00000000b004', 'authenticated', 'authenticated', 'new@y.org',    now(), null);

insert into public.profiles (id, email, full_name, role, status, person_id) values
  ('00000000-0000-0000-0000-00000000a001', 'admin@x.org',  'Admin',          'admin',  'active',  null),
  ('00000000-0000-0000-0000-00000000b001', 'link@x.org',   'Link Member',    'member', 'pending', null),
  ('00000000-0000-0000-0000-00000000b002', 'change@x.org', 'Change Member',  'member', 'pending', null),
  ('00000000-0000-0000-0000-00000000b003', 'unc@x.org',    'Unc Member',     'member', 'pending', null),
  ('00000000-0000-0000-0000-00000000b004', 'new@y.org',    'New Member',     'member', 'pending', '00000000-0000-0000-0000-00000000c004');

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

-- Snapshot of the single staff queue, written as an administrator. Columns match list_account_link_queue (103).
create table id103_test.queue_snap (
  profile_id uuid, display_name text, created_at timestamptz, person_id uuid, person_name text
);
grant select, insert on id103_test.queue_snap to authenticated;

-- ── Link gate (099 checks kept; pending email change refused by 103) ──────────────────────────────────────────────────
select id103_test.expect_error('L1 link refuses an account with a pending email change',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000c002','Matched by staff review')$q$);
select id103_test.expect_error('L2 link refuses an unconfirmed email',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-00000000c003','Matched by staff review')$q$);
select id103_test.expect_error('L3 link refuses a short reason',
  '00000000-0000-0000-0000-00000000a001', '22023',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000c001','x')$q$);

-- ── Staff queue: one RPC, reason-gated, audited, no email addresses ───────────────────────────────────────────────────
select id103_test.expect_ok('Q0 administrator reads the queue with a reason',
  '00000000-0000-0000-0000-00000000a001',
  $q$insert into id103_test.queue_snap select * from public.list_account_link_queue('Desk review of pending accounts')$q$);
insert into id103_test.results
  select 'Q1 queue holds the confirmed unlinked accounts only (LINK and CHANGE; not the unverified or the linked one)',
         (select count(*) = 2 from id103_test.queue_snap)
           and exists (select 1 from id103_test.queue_snap where profile_id = '00000000-0000-0000-0000-00000000b001')
           and exists (select 1 from id103_test.queue_snap where profile_id = '00000000-0000-0000-0000-00000000b002')
           and not exists (select 1 from id103_test.queue_snap where profile_id in ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-00000000b004')),
         'rows';
insert into id103_test.results
  select 'Q2 each candidate is the exact normalised-email match',
         exists (select 1 from id103_test.queue_snap where profile_id = '00000000-0000-0000-0000-00000000b002'
                   and person_id = '00000000-0000-0000-0000-00000000c002' and person_name = 'Change Person'),
         'candidate';
insert into id103_test.results
  select 'Q3 the queue returns no email address in any column',
         not exists (select 1 from id103_test.queue_snap
                      where display_name like '%@%' or person_name like '%@%'),
         'no email';
insert into id103_test.results
  select 'Q4 a queue call writes an audit row for the administrator with the nil target',
         exists (select 1 from public.identity_read_audit
                  where actor_id = '00000000-0000-0000-0000-00000000a001' and target_kind = 'account_link'
                    and target_id = '00000000-0000-0000-0000-000000000000'),
         'audit';
select id103_test.expect_error('Q5 a member cannot read the queue',
  '00000000-0000-0000-0000-00000000b001', '42501',
  $q$select * from public.list_account_link_queue('Desk review of pending accounts')$q$);
select id103_test.expect_error('Q6 a queue call with a short reason is refused',
  '00000000-0000-0000-0000-00000000a001', '22023',
  $q$select * from public.list_account_link_queue('x')$q$);
insert into id103_test.results
  select 'Q7 anon has no execute right on the queue',
         not has_function_privilege('anon', 'public.list_account_link_queue(text)', 'execute'),
         'catalog';

-- ── Approval gate: an unlinked pending account is refused, a linked one is approved; approval is audited ──────────────
select id103_test.expect_error('A1 approve refuses an unlinked account whose email matches a person',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b001')$q$);
select id103_test.expect_error('A2 approve refuses an unlinked, unverified account (gate covers every unlinked pending profile)',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b003')$q$);
select id103_test.expect_ok('A3 approve succeeds for a new member (linked at signup)',
  '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b004')$q$);
select id103_test.expect_ok('A4 repeat approval is accepted and changes nothing',
  '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b004')$q$);
insert into id103_test.results
  select 'A5 new-member approval wrote exactly one approval audit row',
         (select count(*) = 1 from public.profile_approval_audit where profile_id = '00000000-0000-0000-0000-00000000b004'),
         'audit';

-- GoTrue clears the pending change when it is confirmed or cancelled. Simulated here as the owner.
update auth.users set email_change = null where id = '00000000-0000-0000-0000-00000000b002';

select id103_test.expect_ok('A6 link succeeds once the pending change is cleared',
  '00000000-0000-0000-0000-00000000a001',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000c002','Matched by staff review')$q$);
select id103_test.expect_ok('A7 link succeeds for a confirmed, matching account',
  '00000000-0000-0000-0000-00000000a001',
  $q$select public.link_pending_profile_to_person('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000c001','Confirmed by staff review')$q$);
select id103_test.expect_ok('A8 approval succeeds after linking',
  '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b001')$q$);
insert into id103_test.results
  select 'A9 link audit row written for the link',
         (select count(*) = 1 from public.profile_link_audit where profile_id = '00000000-0000-0000-0000-00000000b001' and action = 'attach'),
         'link audit';
insert into id103_test.results
  select 'A10 approval audit holds exactly the two authorised approvals',
         (select count(*) = 2 from public.profile_approval_audit),
         'approval audit';
select id103_test.expect_error('A11 a member cannot approve (42501)',
  '00000000-0000-0000-0000-00000000b002', '42501',
  $q$select * from public.approve_pending_member('00000000-0000-0000-0000-00000000b003')$q$);

-- ── Append-only audit: client and owner writes refused; TRUNCATE refused on every audit table ───────────────────────
select id103_test.expect_error('T1 client cannot insert an approval audit row',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$insert into public.profile_approval_audit (profile_id, actor_id, action) values ('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-00000000a001','approve')$q$);
select id103_test.expect_error('T2 client cannot update the approval audit',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$update public.profile_approval_audit set action = 'approve'$q$);
select id103_test.expect_error('T3 client cannot delete from the approval audit',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$delete from public.profile_approval_audit$q$);
select id103_test.expect_error('T4 client cannot truncate the approval audit',
  '00000000-0000-0000-0000-00000000a001', '42501',
  $q$truncate public.profile_approval_audit$q$);
select id103_test.expect_owner_error('T5 owner update is refused by the append-only trigger', '42501',
  $q$update public.profile_approval_audit set action = 'approve'$q$);
select id103_test.expect_owner_error('T6 owner delete is refused by the append-only trigger', '42501',
  $q$delete from public.profile_approval_audit$q$);
select id103_test.expect_owner_error('T7 owner truncate of the approval audit is refused by the statement trigger', '42501',
  $q$truncate public.profile_approval_audit$q$);
select id103_test.expect_owner_error('T8 owner truncate of the identity read audit is refused', '42501',
  $q$truncate public.identity_read_audit$q$);
select id103_test.expect_owner_error('T9 owner truncate of the profile link audit is refused', '42501',
  $q$truncate public.profile_link_audit$q$);
insert into id103_test.results
  select 'T10 approval audit rows survive every refused operation',
         (select count(*) = 2 from public.profile_approval_audit),
         'rows';

-- ── Candidate reveal: staff only, reason-gated, audited ───────────────────────────────────────────────────────────────
select id103_test.expect_ok('R1 staff reveal with a reason is allowed',
  '00000000-0000-0000-0000-00000000a001',
  $q$select * from public.get_person_identity('00000000-0000-0000-0000-00000000c001', 'Confirmed by staff review')$q$);
select id103_test.expect_error('R2 member cannot reveal a person',
  '00000000-0000-0000-0000-00000000b001', '42501',
  $q$select * from public.get_person_identity('00000000-0000-0000-0000-00000000c001', 'Confirmed by staff review')$q$);
insert into id103_test.results
  select 'R3 the staff reveal is audited',
         (select count(*) >= 1 from public.identity_read_audit where target_id = '00000000-0000-0000-0000-00000000c001'),
         'audit';

-- Result: "<checks>|<failed>" on the last line, read by the workflow.
select count(*) || '|' || count(*) filter (where not ok) from id103_test.results;

rollback;
