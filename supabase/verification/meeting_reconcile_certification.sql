-- Reconciliation certification for meetings on the unified candidate (migrations 000–072).
-- Adds the checks specific to the reconciliation: preserved invitee policy, no forged outcomes, no widened rosters,
-- caller-scoped resolution for cell leaders, export compatibility, and the pending-account boundary for targeted events.
-- Transactional. One PASS/FAIL row per check, then the summary.

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
  coord uuid := gen_random_uuid();
  leader uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  pending_id uuid := gen_random_uuid();
  cell_x uuid := gen_random_uuid();
  mtg uuid := gen_random_uuid();
  mtg_cell uuid := gen_random_uuid();
  ev_all uuid := gen_random_uuid();
  ev_cells uuid := gen_random_uuid();
  spec_cells uuid;
  state text;
  n integer;
  v_rows integer;
  v_json jsonb;
  v_def text;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  select u, u::text || '@recon.invalid', 'x', 'authenticated', 'authenticated', now(), now()
  from unnest(array[coord, leader, member, other, outsider, pending_id]) u;

  insert into public.profiles (id, email, full_name, role, status, cell_id) values
    (coord,      coord::text || '@recon.invalid',   'Recon Coordinator', 'coordinator', 'active',  null),
    (leader,     leader::text || '@recon.invalid',  'Recon Leader',      'cell_leader', 'active',  null),
    (member,     member::text || '@recon.invalid',  'Recon Member',      'member',      'active',  null),
    (other,      other::text || '@recon.invalid',   'Recon Other',       'member',      'active',  null),
    (outsider,   outsider::text || '@recon.invalid','Recon Outsider',    'member',      'active',  null),
    (pending_id, pending_id::text || '@recon.invalid','Recon Pending',   'member',      'pending', null)
  on conflict (id) do update set status = excluded.status, role = excluded.role, cell_id = excluded.cell_id, full_name = excluded.full_name;

  insert into public.cells (id, name, leader_id) values (cell_x, 'Recon Cell', leader);
  update public.profiles set cell_id = cell_x where id in (member, other);

  insert into public.meetings (id, title, date, time, visibility, category, created_by)
  values (mtg, 'Recon private', current_date + 4, '18:00', 'explicit', 'general', coord);
  insert into public.meetings (id, title, date, time, visibility, category, cell_id, created_by)
  values (mtg_cell, 'Recon cell meeting', current_date + 5, '18:00', 'cell', 'cell', cell_x, leader);

  -- Preserved policy: 061's name, 066's invitee helper, and no direct read of meeting_attendances from the policy.
  select pg_get_expr(polqual, polrelid) into v_def from pg_policy
  where polrelid = 'public.meetings'::regclass and polname = 'meetings_explicit_invitee_read';
  perform pg_temp.record('Preserved', 'meetings_explicit_invitee_read still uses is_meeting_invitee()',
    v_def is not null and v_def like '%is_meeting_invitee%', v_def);
  perform pg_temp.record('Preserved', 'is_meeting_invitee() still exists, is definer and is not executable by anon',
    (select prosecdef from pg_proc where proname = 'is_meeting_invitee' and pronamespace = 'public'::regnamespace)
    and not has_function_privilege('anon', 'public.is_meeting_invitee(uuid)', 'execute'),
    'is_meeting_invitee');

  -- Cell leader: explicit invite of an own-cell member goes through the caller-scoped path and works.
  perform pg_temp.as_auth(leader);
  v_json := public.set_meeting_audience(mtg_cell, 'explicit', '{}', '{}', array[member]::uuid[], false);
  perform pg_temp.as_postgres();
  perform pg_temp.record('RPC', 'cell leader invites an own-cell member (caller-scoped resolution)',
    (v_json->>'recipients')::int = 1, v_json::text);

  perform pg_temp.as_auth(leader);
  state := pg_temp.try(format($q$select public.set_meeting_audience(%L, 'explicit', '{}', '{}', array[%L]::uuid[], false)$q$, mtg_cell, outsider));
  perform pg_temp.as_postgres();
  perform pg_temp.record('RPC', 'cell leader cannot invite a member of another cell', state = '42501', state);

  -- Forging: an invitee cannot record a staff-only outcome on their own row, by insert or by update.
  perform pg_temp.as_auth(coord);
  v_json := public.set_meeting_audience(mtg, 'explicit', '{}', '{}', array[member]::uuid[], false);
  perform pg_temp.as_postgres();

  perform pg_temp.as_auth(member);
  state := pg_temp.try(format($q$insert into public.meeting_attendances (meeting_id, user_id, user_name, attendance_status) values (%L, %L, 'x', 'attended')$q$, mtg, member));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Forging', 'member cannot insert their own attendance as attended', state in ('42501', '23505'), state);

  perform pg_temp.as_auth(member);
  update public.meeting_attendances set attendance_status = 'attended' where meeting_id = mtg and user_id = member;
  get diagnostics v_rows = row_count;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Forging', 'member cannot update their own attendance to attended', v_rows = 0, v_rows::text);

  perform pg_temp.as_auth(member);
  state := pg_temp.try(format($q$insert into public.meeting_attendances (meeting_id, user_id, user_name) values (%L, %L, 'x')$q$, mtg, other));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Forging', 'member cannot add someone else to a meeting roster', state = '42501', state);

  perform pg_temp.as_auth(member);
  state := pg_temp.try(format($q$select public.respond_to_meeting_invitation(%L, 'attended')$q$, mtg));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Forging', 'member cannot answer with the attended state', state = '22023', state);

  -- Staff outcome, then the protections on it.
  perform pg_temp.as_auth(coord);
  update public.meeting_attendances set attendance_status = 'absent' where meeting_id = mtg and user_id = member;
  perform pg_temp.as_postgres();
  perform pg_temp.as_auth(member);
  state := pg_temp.try(format($q$select public.respond_to_meeting_invitation(%L, 'confirmed')$q$, mtg));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Discard', 'recorded absence cannot be overwritten by the invitee', state = '23514', state);
  perform pg_temp.as_auth(member);
  state := pg_temp.try(format($q$delete from public.meeting_attendances where meeting_id = %L and user_id = %L$q$, mtg, member));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Discard', 'invitee cannot delete their invitation', (select count(*) from public.meeting_attendances where meeting_id = mtg and user_id = member) = 1,
    state);

  -- Legacy export compatibility: the boolean follows the state, so the CSV export keeps its meaning.
  perform pg_temp.record('Export', 'legacy attended boolean follows attendance_status',
    (select attended from public.meeting_attendances where meeting_id = mtg and user_id = member) is false
    and (select attendance_status from public.meeting_attendances where meeting_id = mtg and user_id = member) = 'absent',
    'absent/false');

  -- Targeted events and the pending boundary.
  insert into public.audience_specs (mode, cell_ids, created_by) values ('cells', array[cell_x]::uuid[], coord) returning id into spec_cells;
  insert into public.events (id, title, date, time, category, created_by, audience, audience_spec_id)
  values (ev_cells, 'Recon cell event', current_date + 2, '18:00', 'Other', coord, 'cells', spec_cells);
  insert into public.events (id, title, date, time, category, created_by, audience)
  values (ev_all, 'Recon all-members event', current_date + 2, '18:00', 'Other', coord, 'all');

  perform pg_temp.as_auth(member);
  select count(*) into n from public.events where id = ev_cells;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'a member of the targeted cell reads the cell event', n = 1, n::text);

  perform pg_temp.as_auth(other);
  select count(*) into n from public.events where id = ev_cells;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'a member of the targeted cell reads the event', n = 1, n::text);

  perform pg_temp.as_auth(outsider);
  select count(*) into n from public.events where id = ev_cells;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'an unrelated member cannot read a targeted cell event', n = 0, n::text);

  perform pg_temp.as_auth(pending_id);
  select count(*) into n from public.events where id = ev_cells;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'a pending account cannot read a targeted event', n = 0, n::text);

  perform pg_temp.as_auth(pending_id);
  select count(*) into n from public.events where id = ev_all;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Events', 'a pending account still reads an all-members event (approval screen)', n = 1, n::text);

  -- Cell-leader visibility of a draft in another cell, and of the private meeting.
  perform pg_temp.as_auth(leader);
  select count(*) into n from public.meetings where id = mtg;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Visibility', 'a cell leader of another cell cannot read the coordinator private meeting', n = 0, n::text);

  -- Pending accounts never receive a meeting through the invitation path.
  perform pg_temp.as_auth(pending_id);
  select count(*) into n from public.meetings where id = mtg_cell;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Visibility', 'a pending account reads no meeting', n = 0, n::text);
end $$;

select area, check_name, result, evidence from cert_results order by area, check_name;
select count(*) filter (where result = 'FAIL') as failures, count(*) as checks from cert_results;

rollback;
