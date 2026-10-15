-- Meeting attendance RLS certification.
-- Run against a local replayed database after applying migration 026.
-- This script is intentionally transactional and rolls back all fixture data.
-- F-5: replaced RAISE EXCEPTION abort-on-failure with a cert_results pass/fail
-- accumulation table so all checks run regardless of earlier failures.

begin;

create extension if not exists pgcrypto;

create temporary table cert_results (area text not null, check_name text not null, result text not null, evidence text) on commit drop;

create or replace function pg_temp.cert_pass(area text, check_name text, evidence text default null)
returns void language plpgsql security definer as $$ begin insert into cert_results values (area, check_name, 'PASS', evidence); end $$;
create or replace function pg_temp.cert_fail(area text, check_name text, evidence text)
returns void language plpgsql security definer as $$ begin insert into cert_results values (area, check_name, 'FAIL', evidence); end $$;

create or replace function pg_temp.as_auth(user_id uuid)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;

do $$
declare
  active_member_id uuid := gen_random_uuid();
  unrelated_member_id uuid := gen_random_uuid();
  pending_member_id uuid := gen_random_uuid();
  rejected_member_id uuid := gen_random_uuid();
  coordinator_id uuid := gen_random_uuid();
  leader_id uuid := gen_random_uuid();
  meeting_owner_id uuid := gen_random_uuid();
  test_cell_id uuid := gen_random_uuid();
  test_meeting_id uuid := gen_random_uuid();
  other_attendance_id uuid := gen_random_uuid();
  visible_count integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  values
    (active_member_id,    'attendance-active@example.invalid',      'x', 'authenticated', 'authenticated', now(), now()),
    (unrelated_member_id, 'attendance-unrelated@example.invalid',   'x', 'authenticated', 'authenticated', now(), now()),
    (pending_member_id,   'attendance-pending@example.invalid',     'x', 'authenticated', 'authenticated', now(), now()),
    (rejected_member_id,  'attendance-rejected@example.invalid',    'x', 'authenticated', 'authenticated', now(), now()),
    (coordinator_id,      'attendance-coordinator@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (leader_id,           'attendance-leader@example.invalid',      'x', 'authenticated', 'authenticated', now(), now()),
    (meeting_owner_id,    'attendance-owner@example.invalid',       'x', 'authenticated', 'authenticated', now(), now());

  insert into public.profiles (id, email, full_name, role, status)
  values
    (active_member_id,    'attendance-active@example.invalid',      'Attendance Active',      'member',      'active'),
    (unrelated_member_id, 'attendance-unrelated@example.invalid',   'Attendance Unrelated',   'member',      'active'),
    (pending_member_id,   'attendance-pending@example.invalid',     'Attendance Pending',     'member',      'pending'),
    (rejected_member_id,  'attendance-rejected@example.invalid',    'Attendance Rejected',    'member',      'rejected'),
    (coordinator_id,      'attendance-coordinator@example.invalid', 'Attendance Coordinator', 'coordinator', 'active'),
    (leader_id,           'attendance-leader@example.invalid',      'Attendance Leader',      'cell_leader', 'active'),
    (meeting_owner_id,    'attendance-owner@example.invalid',       'Attendance Owner',       'member',      'active')
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    status = excluded.status;

  insert into public.cells (id, name, leader_id)
  values (test_cell_id, 'Attendance Test Cell', leader_id);

  update public.profiles set cell_id = test_cell_id where id in (leader_id, active_member_id);

  insert into public.meetings (id, title, date, time, visibility, cell_id, created_by)
  values (test_meeting_id, 'Attendance Test Meeting', current_date, '19:00', 'public', test_cell_id, meeting_owner_id);

  insert into public.meeting_attendances (id, meeting_id, user_id, user_name)
  values
    (gen_random_uuid(),    test_meeting_id, active_member_id,    'Attendance Active'),
    (other_attendance_id,  test_meeting_id, unrelated_member_id, 'Attendance Unrelated');

  -- Active member: sees only their own row; meeting itself remains readable.
  perform pg_temp.as_auth(active_member_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count = 1 then perform pg_temp.cert_pass('Attendance', 'active member sees only their own attendance row', visible_count::text);
  else perform pg_temp.cert_fail('Attendance', 'active member sees only their own attendance row', visible_count::text); end if;
  if exists (select 1 from public.meetings where id = test_meeting_id) then
    perform pg_temp.cert_pass('Attendance', 'dashboard meeting query without attendance embedding remains readable', test_meeting_id::text);
  else
    perform pg_temp.cert_fail('Attendance', 'dashboard meeting query without attendance embedding remains readable', test_meeting_id::text);
  end if;
  perform pg_temp.as_postgres();

  -- Unrelated active member: also sees only their own row.
  perform pg_temp.as_auth(unrelated_member_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  perform pg_temp.as_postgres();
  if visible_count = 1 then perform pg_temp.cert_pass('Attendance', 'unrelated active member sees only their own row', visible_count::text);
  else perform pg_temp.cert_fail('Attendance', 'unrelated active member sees only their own row', visible_count::text); end if;

  -- Pending member: sees nothing.
  perform pg_temp.as_auth(pending_member_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  perform pg_temp.as_postgres();
  if visible_count = 0 then perform pg_temp.cert_pass('Attendance', 'pending member cannot read attendance rows', visible_count::text);
  else perform pg_temp.cert_fail('Attendance', 'pending member cannot read attendance rows', visible_count::text); end if;

  -- Rejected member: sees nothing.
  perform pg_temp.as_auth(rejected_member_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  perform pg_temp.as_postgres();
  if visible_count = 0 then perform pg_temp.cert_pass('Attendance', 'rejected member cannot read attendance rows', visible_count::text);
  else perform pg_temp.cert_fail('Attendance', 'rejected member cannot read attendance rows', visible_count::text); end if;

  -- Coordinator: sees all rows for management/export.
  perform pg_temp.as_auth(coordinator_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  perform pg_temp.as_postgres();
  if visible_count = 2 then perform pg_temp.cert_pass('Attendance', 'coordinator reads all attendance rows for export/management', visible_count::text);
  else perform pg_temp.cert_fail('Attendance', 'coordinator reads all attendance rows for export/management', visible_count::text); end if;

  -- Cell leader: sees all rows for their cell meeting, and can mark attendance.
  perform pg_temp.as_auth(leader_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count = 2 then perform pg_temp.cert_pass('Attendance', 'cell leader reads all attendance rows for their cell meeting', visible_count::text);
  else perform pg_temp.cert_fail('Attendance', 'cell leader reads all attendance rows for their cell meeting', visible_count::text); end if;
  update public.meeting_attendances set attended = true where id = other_attendance_id;
  get diagnostics visible_count = row_count;
  perform pg_temp.as_postgres();
  if visible_count = 1 and exists (select 1 from public.meeting_attendances where id = other_attendance_id and attended is true) then
    perform pg_temp.cert_pass('Attendance', 'cell leader can mark attendance for their cell meeting', visible_count::text);
  else
    perform pg_temp.cert_fail('Attendance', 'cell leader can mark attendance for their cell meeting', visible_count::text);
  end if;

  -- Meeting owner: sees all rows for their owned meeting.
  perform pg_temp.as_auth(meeting_owner_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  perform pg_temp.as_postgres();
  if visible_count = 2 then perform pg_temp.cert_pass('Attendance', 'meeting owner reads all attendance rows for owned meeting', visible_count::text);
  else perform pg_temp.cert_fail('Attendance', 'meeting owner reads all attendance rows for owned meeting', visible_count::text); end if;
end $$;

select area, check_name, result, left(coalesce(evidence, ''), 90) as evidence from cert_results order by area, check_name;
select count(*) filter (where result = 'FAIL') as failures, count(*) as checks from cert_results;
rollback;
