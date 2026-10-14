-- Meeting integration certification (ops/blwyork-operational, migrations 000–067).
-- Covers the ten meeting scenarios from the integration brief, plus pending and rejected accounts and a regression for
-- the 061 recursion that 066 repairs. Run against a database that has every migration applied.
--
-- Transactional: all fixture data is rolled back. Every check writes one PASS/FAIL row; the last result line is the summary.
-- Roles are switched with SET ROLE authenticated and request.jwt.claim.sub, which is how PostgREST evaluates RLS.

begin;

create temporary table cert_results (area text not null, check_name text not null, result text not null, evidence text)
  on commit drop;

create or replace function pg_temp.record(p_area text, p_name text, p_ok boolean, p_evidence text default null)
returns void language plpgsql as $$
begin
  insert into cert_results values (p_area, p_name, case when p_ok then 'PASS' else 'FAIL' end, p_evidence);
end $$;

create or replace function pg_temp.as_auth(p_user uuid)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;

-- Runs a statement as the current role and returns the SQLSTATE raised, or 'none'.
create or replace function pg_temp.try(p_stmt text)
returns text language plpgsql as $$
begin
  execute p_stmt;
  return 'none';
exception when others then
  return sqlstate;
end $$;

do $$
declare
  admin_id uuid := gen_random_uuid();
  coord_id uuid := gen_random_uuid();
  leader_a uuid := gen_random_uuid();
  leader_b uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  a3 uuid := gen_random_uuid();
  a4 uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  pending_id uuid := gen_random_uuid();
  rejected_id uuid := gen_random_uuid();
  cell_a uuid := gen_random_uuid();
  cell_b uuid := gen_random_uuid();
  group_x uuid := gen_random_uuid();
  all_meeting uuid := gen_random_uuid();
  private_meeting uuid := gen_random_uuid();
  cell_meeting uuid := gen_random_uuid();
  draft_meeting uuid := gen_random_uuid();
  cells_event uuid := gen_random_uuid();
  v_json jsonb;
  v_spec_before uuid;
  n integer;
  v_rows integer;
  state text;
  v_status text;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  select u, u::text || '@ops-cert.invalid', 'x', 'authenticated', 'authenticated', now(), now()
  from unnest(array[admin_id, coord_id, leader_a, leader_b, a1, a2, a3, a4, b1, outsider, pending_id, rejected_id]) u;

  insert into public.profiles (id, email, full_name, role, status, cell_id) values
    (admin_id,   admin_id::text   || '@ops-cert.invalid', 'Cert Admin',       'admin',       'active',   null),
    (coord_id,   coord_id::text   || '@ops-cert.invalid', 'Cert Coordinator', 'coordinator', 'active',   null),
    (leader_a,   leader_a::text   || '@ops-cert.invalid', 'Cert Leader A',    'cell_leader', 'active',   null),
    (leader_b,   leader_b::text   || '@ops-cert.invalid', 'Cert Leader B',    'cell_leader', 'active',   null),
    (a1,         a1::text         || '@ops-cert.invalid', 'Cert Member A1',   'member',      'active',   null),
    (a2,         a2::text         || '@ops-cert.invalid', 'Cert Member A2',   'member',      'active',   null),
    (a3,         a3::text         || '@ops-cert.invalid', 'Cert Member A3',   'member',      'active',   null),
    (a4,         a4::text         || '@ops-cert.invalid', 'Cert Member A4',   'member',      'active',   null),
    (b1,         b1::text         || '@ops-cert.invalid', 'Cert Member B1',   'member',      'active',   null),
    (outsider,   outsider::text   || '@ops-cert.invalid', 'Cert Outsider',    'member',      'active',   null),
    (pending_id, pending_id::text || '@ops-cert.invalid', 'Cert Pending',     'member',      'pending',  null),
    (rejected_id,rejected_id::text|| '@ops-cert.invalid', 'Cert Rejected',    'member',      'rejected', null)
  on conflict (id) do update set status = excluded.status, role = excluded.role, cell_id = excluded.cell_id, full_name = excluded.full_name;

  insert into public.cells (id, name, leader_id) values (cell_a, 'Cert Cell A', leader_a), (cell_b, 'Cert Cell B', leader_b);
  perform set_config('app.cell_change_reason', 'owner fixture setup', false);
  update public.profiles set cell_id = cell_a where id in (a1, a2, a3, a4);
  perform set_config('app.cell_change_reason', 'owner fixture setup', false);
  update public.profiles set cell_id = cell_b where id = b1;

  insert into public.saved_groups (id, name, created_by) values (group_x, 'Cert Group X', coord_id);
  insert into public.saved_group_members (group_id, profile_id, added_by) values (group_x, b1, coord_id), (group_x, a1, coord_id);

  -- Meetings are created by the people who would create them. The published default applies to the first three.
  perform pg_temp.as_auth(admin_id);
  insert into public.meetings (id, title, date, time, visibility, category, created_by)
  values (all_meeting, 'Cert all members', current_date + 2, '18:00', 'public', 'general', admin_id);
  insert into public.meetings (id, title, date, time, visibility, category, created_by)
  values (private_meeting, 'Cert private', current_date + 3, '18:00', 'explicit', 'general', admin_id);
  perform pg_temp.as_postgres();

  perform pg_temp.as_auth(leader_a);
  insert into public.meetings (id, title, date, time, visibility, category, cell_id, created_by)
  values (cell_meeting, 'Cert cell A', current_date + 4, '18:00', 'cell', 'cell', cell_a, leader_a);
  perform pg_temp.as_postgres();

  insert into public.meetings (id, title, date, time, visibility, category, created_by, published_at)
  values (draft_meeting, 'Cert draft', current_date + 5, '18:00', 'public', 'general', admin_id, null);

  -- Scenario 1: admin schedules for all active members.
  perform pg_temp.as_auth(admin_id);
  v_json := public.set_meeting_audience(all_meeting, 'all', '{}', '{}', '{}', false);
  perform pg_temp.as_postgres();
  select count(*) into n from public.meeting_attendances where meeting_id = all_meeting;
  perform pg_temp.record('E2E-01', 'admin schedules a meeting for all active members',
    n = (select count(*) from public.profiles where status = 'active')
    and not exists (select 1 from public.meeting_attendances where meeting_id = all_meeting and user_id in (pending_id, rejected_id)),
    v_json::text);

  -- Scenario 2: admin schedules for three selected members.
  perform pg_temp.as_auth(admin_id);
  v_json := public.set_meeting_audience(private_meeting, 'explicit', '{}', '{}', array[a1, a2, a3]::uuid[], false);
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-02', 'admin schedules a meeting for three selected members',
    (v_json->>'recipients')::int = 3 and (select count(*) from public.meeting_attendances where meeting_id = private_meeting) = 3,
    v_json::text);

  -- Snapshot: each invitation records the spec that produced it.
  perform pg_temp.record('E2E-10', 'every invitation records the meeting''s current audience spec',
    not exists (
      select 1 from public.meeting_attendances ma join public.meetings m on m.id = ma.meeting_id
      where ma.invited_via <> 'self' and ma.audience_spec_id is distinct from m.audience_spec_id
    ) and (select count(*) from public.meeting_attendances where meeting_id = private_meeting and audience_spec_id is not null) = 3,
    'spec linkage');

  -- Scenario 3: only the three invitees read the private meeting.
  perform pg_temp.as_auth(a1);
  select count(*) into n from public.meetings where id = private_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-03', 'invited member a1 reads the private meeting', n = 1, n::text);

  perform pg_temp.as_auth(a3);
  select count(*) into n from public.meetings where id = private_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-03', 'invited member a3 reads the private meeting', n = 1, n::text);

  perform pg_temp.as_auth(b1);
  select count(*) into n from public.meetings where id = private_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-03', 'member b1 (in a saved group, not invited) cannot read it', n = 0, n::text);

  perform pg_temp.as_auth(a4);
  select count(*) into n from public.meetings where id = private_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-03', 'member a4 (same cell, not invited) cannot read it', n = 0, n::text);

  -- Scenario 4: a cell leader schedules a meeting for authorised members.
  perform pg_temp.as_auth(leader_a);
  v_json := public.set_meeting_audience(cell_meeting, 'cells', array[cell_a]::uuid[], '{}', '{}', false);
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-04', 'cell leader schedules a cell meeting for their own cell',
    (v_json->>'recipients')::int = 4, v_json::text);

  perform pg_temp.as_auth(leader_a);
  state := pg_temp.try(format($q$select public.set_meeting_audience(%L, 'cells', array[%L]::uuid[], '{}', '{}', false)$q$, cell_meeting, cell_b));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-04', 'cell leader cannot schedule for another cell', state = '42501', state);

  perform pg_temp.as_auth(leader_a);
  state := pg_temp.try(format($q$select public.set_meeting_audience(%L, 'all', '{}', '{}', '{}', false)$q$, cell_meeting));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-04', 'cell leader cannot schedule for all members', state = '42501', state);

  -- Leader A does not manage the admin-created private meeting (its cell is null). Expect refusal.
  perform pg_temp.as_auth(leader_a);
  state := pg_temp.try(format($q$select public.set_meeting_audience(%L, 'explicit', '{}', '{}', array[%L]::uuid[], false)$q$, private_meeting, a2));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-04', 'cell leader is refused on a meeting outside their cell', state = '42501', state);

  perform pg_temp.as_auth(leader_b);
  state := pg_temp.try(format($q$select public.set_meeting_audience(%L, 'explicit', '{}', '{}', array[%L]::uuid[], false)$q$, cell_meeting, a1));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-04', 'leader of another cell cannot invite into this cell meeting', state = '42501', state);

  -- Scenario 5: an outsider is denied by direct table queries.
  perform pg_temp.as_auth(outsider);
  select count(*) into n from public.meetings where id = private_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-05', 'outsider cannot read the private meeting by id', n = 0, n::text);

  perform pg_temp.as_auth(outsider);
  select count(*) into n from public.meeting_attendances where meeting_id = private_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-05', 'outsider cannot read the private meeting roster', n = 0, n::text);

  perform pg_temp.as_auth(outsider);
  state := pg_temp.try(format($q$insert into public.meeting_attendances (meeting_id, user_id, user_name) values (%L, %L, 'x')$q$, private_meeting, outsider));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-05', 'outsider cannot self-register into the private meeting', state = '42501', state);

  perform pg_temp.as_auth(outsider);
  state := pg_temp.try(format($q$select public.respond_to_meeting_invitation(%L, 'confirmed')$q$, private_meeting));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-05', 'outsider cannot respond to the private meeting', state = 'P0002', state);

  -- Scenario 6: invitees confirm or excuse themselves.
  perform pg_temp.as_auth(a1);
  state := pg_temp.try(format($q$select public.respond_to_meeting_invitation(%L, 'confirmed')$q$, private_meeting));
  perform pg_temp.as_postgres();
  select attendance_status into v_status from public.meeting_attendances where meeting_id = private_meeting and user_id = a1;
  perform pg_temp.record('E2E-06', 'invitee confirms attendance', state = 'none' and v_status = 'confirmed', state || ':' || coalesce(v_status, ''));

  perform pg_temp.as_auth(a2);
  state := pg_temp.try(format($q$select public.respond_to_meeting_invitation(%L, 'excused')$q$, private_meeting));
  perform pg_temp.as_postgres();
  select attendance_status into v_status from public.meeting_attendances where meeting_id = private_meeting and user_id = a2;
  perform pg_temp.record('E2E-06', 'invitee excuses themselves and the row is kept', state = 'none' and v_status = 'excused', state || ':' || coalesce(v_status, ''));

  perform pg_temp.as_auth(a1);
  update public.meeting_attendances set attendance_status = 'attended' where meeting_id = private_meeting and user_id = a1;
  get diagnostics v_rows = row_count;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-06', 'invitee cannot record their own attendance', v_rows = 0, v_rows::text);

  -- Scenario 7: staff mark attendance.
  perform pg_temp.as_auth(coord_id);
  update public.meeting_attendances set attendance_status = 'attended' where meeting_id = private_meeting and user_id = a1;
  update public.meeting_attendances set attendance_status = 'absent' where meeting_id = private_meeting and user_id = a3;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-07', 'staff mark attended and absent, and the legacy boolean follows',
    (select attended from public.meeting_attendances where meeting_id = private_meeting and user_id = a1) is true
    and (select attended from public.meeting_attendances where meeting_id = private_meeting and user_id = a3) is false,
    'attended/absent');

  -- Scenario 8: completed attendance is not silently discarded.
  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format($q$select public.set_meeting_audience(%L, 'explicit', '{}', '{}', array[%L, %L]::uuid[], false)$q$, private_meeting, a2, a3));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-08', 'narrowing the audience cannot drop an invitee with recorded attendance', state = '23514', state);
  perform pg_temp.record('E2E-08', 'the attended invitee remains after the refused narrowing',
    (select attendance_status from public.meeting_attendances where meeting_id = private_meeting and user_id = a1) = 'attended', 'a1');

  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format($q$update public.meeting_attendances set attendance_status = 'invited' where meeting_id = %L and user_id = %L$q$, private_meeting, a1));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-08', 'a recorded outcome cannot be reset to invited', state = '23514', state);

  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format($q$delete from public.meeting_attendances where meeting_id = %L and user_id = %L$q$, private_meeting, a1));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-08', 'a recorded outcome cannot be deleted', state = '23514', state);

  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format($q$delete from public.meetings where id = %L$q$, private_meeting));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-08', 'a meeting with recorded attendance cannot be deleted', state = '23514', state);

  -- Scenario 9: pending and rejected accounts.
  perform pg_temp.as_auth(pending_id);
  select count(*) into n from public.meetings where id in (private_meeting, all_meeting, cell_meeting);
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-14', 'pending account reads no meeting, including one it is invited to', n = 0, n::text);

  perform pg_temp.as_auth(rejected_id);
  select count(*) into n from public.meetings where id in (private_meeting, all_meeting, cell_meeting);
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-15', 'rejected account reads no meeting', n = 0, n::text);

  perform pg_temp.as_auth(rejected_id);
  state := pg_temp.try(format($q$select public.respond_to_meeting_invitation(%L, 'confirmed')$q$, all_meeting));
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-15', 'rejected account cannot respond', state in ('42501', 'P0002'), state);

  perform pg_temp.as_auth(pending_id);
  select count(*) into n from public.meetings where id = draft_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-14', 'pending account reads no draft', n = 0, n::text);

  -- Drafts: visible to the creator and to admins, not to members.
  perform pg_temp.as_auth(a1);
  select count(*) into n from public.meetings where id = draft_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Publication', 'a member cannot read a draft', n = 0, n::text);

  perform pg_temp.as_auth(admin_id);
  v_json := public.publish_meeting(draft_meeting);
  perform pg_temp.as_postgres();
  perform pg_temp.record('Publication', 'publishing a draft succeeds for its manager', (select published_at from public.meetings where id = draft_meeting) is not null, v_json::text);

  -- Scenario 10: recipient snapshots remain consistent after audience updates.
  select audience_spec_id into v_spec_before from public.meetings where id = all_meeting;
  perform pg_temp.as_auth(admin_id);
  v_json := public.set_meeting_audience(all_meeting, 'cells', array[cell_b]::uuid[], '{}', '{}', false);
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-10', 'after the audience changes, every invitation matches the current spec and resolves',
    not exists (
      select 1 from public.meeting_attendances ma
      join public.meetings m on m.id = ma.meeting_id
      where ma.meeting_id = all_meeting
        and ma.invited_via <> 'self'
        and (
          ma.audience_spec_id is distinct from m.audience_spec_id
          or not exists (select 1 from public.resolve_audience_all(m.audience_spec_id) r where r.profile_id = ma.user_id)
        )
    )
    and (select count(*) from public.meeting_attendances where meeting_id = all_meeting) = 1,
    v_json::text);
  perform pg_temp.record('E2E-10', 'the previous spec is kept, unchanged, as history',
    v_spec_before is not null and exists (select 1 from public.audience_specs where id = v_spec_before and mode = 'all'),
    'historical spec');

  perform pg_temp.as_auth(admin_id);
  v_json := public.set_meeting_audience(all_meeting, 'cells', array[cell_b]::uuid[], '{}', '{}', true);
  perform pg_temp.as_postgres();
  perform pg_temp.record('E2E-10', 'a dry run changes nothing', (select count(*) from public.meeting_attendances where meeting_id = all_meeting) = 1
    and (select audience_spec_id from public.meetings where id = all_meeting) <> v_spec_before, v_json::text);

  -- Events: an event aimed at the private meeting is readable only by its invitees.
  insert into public.events (id, title, date, time, category, created_by, audience, audience_meeting_id)
  values (gen_random_uuid(), 'Cert private event', current_date + 3, '18:00', 'Other', admin_id, 'meeting', private_meeting);
  insert into public.audience_specs (id, mode, cell_ids, created_by)
  values (gen_random_uuid(), 'cells', array[cell_b]::uuid[], admin_id)
  returning id into v_spec_before;
  insert into public.events (id, title, date, time, category, created_by, audience, audience_spec_id)
  values (cells_event, 'Cert cell B event', current_date + 3, '18:00', 'Other', admin_id, 'cells', v_spec_before);

  perform pg_temp.as_auth(a1);
  select count(*) into n from public.events where audience = 'meeting' and audience_meeting_id = private_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'invitee reads an event aimed at the private meeting', n = 1, n::text);

  perform pg_temp.as_auth(outsider);
  select count(*) into n from public.events where audience = 'meeting' and audience_meeting_id = private_meeting;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'outsider cannot read an event aimed at the private meeting', n = 0, n::text);

  perform pg_temp.as_auth(b1);
  select count(*) into n from public.events where id = cells_event;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'a member of cell B reads the cell B event', n = 1, n::text);

  perform pg_temp.as_auth(a1);
  select count(*) into n from public.events where id = cells_event;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'a member of cell A cannot read the cell B event', n = 0, n::text);

  -- Regression for 061: reading meetings must not recurse.
  perform pg_temp.as_auth(a1);
  state := pg_temp.try('select count(*) from public.meetings');
  perform pg_temp.as_postgres();
  perform pg_temp.record('Regression', 'reading meetings does not raise 42P17 for a member', state = 'none', state);
end $$;

select area, check_name, result, evidence from cert_results order by area, check_name;

select count(*) filter (where result = 'FAIL') as failures, count(*) as checks from cert_results;

rollback;
