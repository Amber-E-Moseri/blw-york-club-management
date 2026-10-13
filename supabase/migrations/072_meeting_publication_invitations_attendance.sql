-- 071_meeting_publication_invitations_attendance.sql
--
-- Owner workstream: Meetings / Attendance (reconciled onto the unified candidate)
-- Dependencies:    009 (meetings), 026 and 034 (attendance policies), 036 (attendance insert scope), 049 and 057 (meeting
--                  leadership), 059 (audience_specs, saved_groups, resolve_audience), 061 and 066 (meetings_explicit_invitee_read,
--                  is_meeting_invitee), 068 (resolve_audience_all, caller-scoped resolve_audience)
-- Contract ref:    docs/ops-shared-contracts.md §1–5, §8, §10
--
-- Forward-only. Migrations through 070 are not edited. Preserved as they stand:
--   * meetings_explicit_invitee_read (061 and 066) and its is_meeting_invitee() helper;
--   * meeting_attendances_select_scoped (061);
--   * meeting_attendances_update_manager (026).
--
-- Adds:
--   1. Publication. meetings.published_at null is a draft, readable by its managers only. The gate is a RESTRICTIVE
--      policy, so it applies on top of every permissive read policy.
--   2. Audience link. meetings.audience_spec_id and meeting_attendances.audience_spec_id tie a meeting and each
--      invitation to an immutable audience_specs row, so recipient snapshots can be checked with resolve_audience_all().
--   3. Attendance states (invited, confirmed, attended, absent, excused) and invitation provenance. The legacy
--      attended boolean (used by the CSV export) is derived from the state.
--   4. Guarded outcomes. A recorded outcome cannot be reset to invited or confirmed, and cannot be deleted.
--   5. Insert and delete policies that stop members from forging an outcome. The 036 insert policy let an active
--      member insert their own row with any state once a state column exists, so it is replaced here.
--   6. RPCs: set_meeting_audience (preview and apply), respond_to_meeting_invitation, publish_meeting.

-- ─── 1. Columns ──────────────────────────────────────────────────────────────────────────────────────────────────────

alter table public.meetings
  add column if not exists published_at timestamptz default now(),
  add column if not exists audience_spec_id uuid references public.audience_specs(id) on delete restrict;

alter table public.meeting_attendances
  add column if not exists attendance_status text not null default 'confirmed',
  add column if not exists invited_via text not null default 'self',
  add column if not exists invited_by uuid references public.profiles(id) on delete set null,
  add column if not exists audience_spec_id uuid references public.audience_specs(id) on delete restrict;

alter table public.meeting_attendances
  drop constraint if exists meeting_attendances_status_check;
alter table public.meeting_attendances
  add constraint meeting_attendances_status_check
    check (attendance_status in ('invited', 'confirmed', 'attended', 'absent', 'excused'));

alter table public.meeting_attendances
  drop constraint if exists meeting_attendances_invited_via_check;
alter table public.meeting_attendances
  add constraint meeting_attendances_invited_via_check
    check (invited_via in ('self', 'member', 'group', 'cell', 'all'));

-- Existing rows: the legacy boolean is the only record of an outcome, so it becomes the state.
update public.meeting_attendances
set attendance_status = case
  when attended is true then 'attended'
  when attended is false then 'absent'
  else 'confirmed'
end
where attendance_status = 'confirmed';

-- ─── 2. Helpers (SECURITY DEFINER, pinned search_path) ───────────────────────────────────────────────────────────────

create or replace function public.meeting_audience_spec(p_meeting_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.audience_spec_id from public.meetings m where m.id = p_meeting_id
$$;

-- Managers: admins and coordinators, the assigned leader of the meeting's cell, and a cell leader who created it.
-- Matches meetings_manage_scoped (057), so the two never disagree about who manages a meeting.
create or replace function public.is_meeting_manager(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and (
    public.is_admin_or_coordinator()
    or exists (
      select 1
      from public.meetings m
      where m.id = p_meeting_id
        and (
          public.is_cell_leader_of(m.cell_id)
          or (m.created_by = auth.uid() and public.current_user_role() = 'cell_leader')
        )
    )
  )
$$;

-- The creator of a meeting, in any role. Used for attendance rows only, as 026 and 061 already allow.
create or replace function public.is_meeting_creator(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and exists (
    select 1 from public.meetings m where m.id = p_meeting_id and m.created_by = auth.uid()
  )
$$;

-- The single read rule for a meeting's details, for an active caller:
--   managers, always;
--   everyone else, once published, when one of the visibility rules holds (009, 049, 045) or the caller is an invitee.
create or replace function public.can_view_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and (
    public.is_meeting_manager(p_meeting_id)
    or exists (
      select 1
      from public.meetings m
      where m.id = p_meeting_id
        and m.published_at is not null
        and (
          m.visibility = 'public'
          or (m.visibility = 'leaders' and (public.is_admin_or_coordinator() or public.is_cell_leader_of(m.cell_id)))
          or (
            m.visibility = 'cell'
            and m.cell_id is not null
            and exists (select 1 from public.profiles p where p.id = auth.uid() and p.cell_id = m.cell_id)
          )
          or public.is_meeting_invitee(m.id)
        )
    )
  )
$$;

-- Whether a profile is among the members an audience spec resolves to. Uses the complete resolver, which is
-- owner-only (068). Callers see only a yes or no for the profile they name.
create or replace function public.is_in_audience_spec(p_spec_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_spec_id is not null and exists (
    select 1 from public.resolve_audience_all(p_spec_id) r where r.profile_id = p_profile_id
  )
$$;

revoke all on function public.meeting_audience_spec(uuid) from public, anon;
revoke all on function public.is_meeting_manager(uuid) from public, anon;
revoke all on function public.is_meeting_creator(uuid) from public, anon;
revoke all on function public.can_view_meeting(uuid) from public, anon;
revoke all on function public.is_in_audience_spec(uuid, uuid) from public, anon;
grant execute on function public.meeting_audience_spec(uuid) to authenticated;
grant execute on function public.is_meeting_manager(uuid) to authenticated;
grant execute on function public.is_meeting_creator(uuid) to authenticated;
grant execute on function public.can_view_meeting(uuid) to authenticated;
grant execute on function public.is_in_audience_spec(uuid, uuid) to authenticated;

-- ─── 3. Triggers ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- Runs before the RLS check, so the policies see the normalised row:
--   * a row for someone other than the caller is never a self registration;
--   * an invitation takes the meeting's current audience spec when it has none;
--   * attendance_status is the source of truth. The legacy attended boolean maps to it, and a write to attended alone
--     maps to attended or absent;
--   * a recorded outcome cannot be reset to invited or confirmed, by the state or by the boolean.
create or replace function public.meeting_attendance_normalise()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_id is distinct from auth.uid() and new.invited_via = 'self' then
    new.invited_via := 'member';
  end if;

  if new.invited_via <> 'self' and new.audience_spec_id is null then
    new.audience_spec_id := public.meeting_audience_spec(new.meeting_id);
  end if;

  if tg_op = 'INSERT' then
    if new.attended is not null and new.attendance_status = 'confirmed' then
      new.attendance_status := case when new.attended then 'attended' else 'absent' end;
    end if;
  elsif new.attendance_status is not distinct from old.attendance_status
    and new.attended is distinct from old.attended then
    if new.attended is true then
      new.attendance_status := 'attended';
    elsif new.attended is false then
      new.attendance_status := 'absent';
    elsif old.attendance_status in ('attended', 'absent') then
      new.attendance_status := 'confirmed';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.attendance_status in ('attended', 'absent')
     and new.attendance_status in ('invited', 'confirmed') then
    raise exception 'Recorded attendance for % cannot be reset to %. Record the person as excused instead.',
      old.user_name, new.attendance_status using errcode = '23514';
  end if;

  new.attended := case new.attendance_status
    when 'attended' then true
    when 'absent' then false
    else null
  end;
  return new;
end;
$$;

revoke all on function public.meeting_attendance_normalise() from public, anon, authenticated;

drop trigger if exists meeting_attendances_normalise on public.meeting_attendances;
create trigger meeting_attendances_normalise
  before insert or update on public.meeting_attendances
  for each row execute function public.meeting_attendance_normalise();

-- An outcome that staff recorded (attended or absent) cannot be deleted. Withdraw it by recording the person as excused.
-- The cascade from a meeting's delete reaches this trigger, so a meeting with recorded attendance cannot be deleted.
create or replace function public.meeting_attendance_guard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.attendance_status in ('attended', 'absent') then
    raise exception 'Attendance for % has been recorded and cannot be deleted. Record the person as excused instead.',
      old.user_name using errcode = '23514';
  end if;
  return old;
end;
$$;

revoke all on function public.meeting_attendance_guard_delete() from public, anon, authenticated;

drop trigger if exists meeting_attendances_guard_delete on public.meeting_attendances;
create trigger meeting_attendances_guard_delete
  before delete on public.meeting_attendances
  for each row execute function public.meeting_attendance_guard_delete();

-- ─── 4. meetings RLS: publication gate ───────────────────────────────────────────────────────────────────────────────

-- Restrictive: applies on top of every permissive SELECT policy (009, 045, 049, 057, 061, 066). A draft is readable by its
-- managers only. An inactive account reads no meeting.
drop policy if exists meetings_publication_gate on public.meetings;
create policy meetings_publication_gate
  on public.meetings
  as restrictive
  for select
  to authenticated
  using (
    public.is_meeting_manager(id)
    or (public.is_active_member() and published_at is not null)
  );

-- ─── 5. meeting_attendances RLS: insert and delete (replace 036 and 026; select and update are kept) ────────────────────

-- Self registration: only into a meeting the caller can see, only as confirmed or excused, never as attended.
-- Staff roster entry for someone else: an active account, not 'self', by the meeting's manager or creator, and inside the
-- meeting's audience when the meeting has one. A roster entry cannot widen the audience.
drop policy if exists meeting_attendances_insert_own_visible on public.meeting_attendances;
create policy meeting_attendances_insert_own_visible
  on public.meeting_attendances
  for insert
  to authenticated
  with check (
    public.is_active_member()
    and (
      (
        user_id = auth.uid()
        and invited_via = 'self'
        and attendance_status in ('confirmed', 'excused')
        and public.can_view_meeting(meeting_id)
      )
      or (
        user_id <> auth.uid()
        and public.is_active_profile(user_id)
        and invited_via <> 'self'
        and (public.is_meeting_manager(meeting_id) or public.is_meeting_creator(meeting_id))
        and (audience_spec_id is null or public.is_in_audience_spec(audience_spec_id, user_id))
      )
    )
  );

-- Own rows can be removed only when they are self registrations. An invitation is withdrawn by a manager, or declined
-- with respond_to_meeting_invitation(..., 'excused'), so the record of who was invited stays intact.
drop policy if exists meeting_attendances_delete_own_or_manager on public.meeting_attendances;
create policy meeting_attendances_delete_own_or_manager
  on public.meeting_attendances
  for delete
  to authenticated
  using (
    public.is_active_member()
    and (
      (user_id = auth.uid() and invited_via = 'self')
      or public.has_admin_permission('attendance.view_all')
      or public.is_meeting_manager(meeting_id)
      or public.is_meeting_creator(meeting_id)
    )
  );

-- ─── 6. RPCs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Previews or applies a meeting audience. Each call writes a new immutable audience_specs row and points the meeting at
-- it. Invitations are reconciled in the same transaction:
--   * new recipients get status 'invited', with provenance from the mode;
--   * recipients still in the audience keep their outcome and move to the new spec;
--   * recipients who left the audience are removed, unless they have a recorded outcome. Then the whole call fails and
--     nothing is written;
--   * self registrations are never removed.
-- Who may use which mode:
--   'all', 'saved_groups'   admins and coordinators;
--   'cells'                 admins, or a cell leader for cells they lead;
--   'explicit'              admins, or a cell leader for members of their own cells.
-- p_dry_run = true runs every check and returns the counts. It leaves one unreferenced spec, the same as preview_audience()
-- (069); no invitation changes.
create or replace function public.set_meeting_audience(
  p_meeting_id uuid,
  p_mode text,
  p_cell_ids uuid[] default '{}',
  p_group_ids uuid[] default '{}',
  p_profile_ids uuid[] default '{}',
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff boolean := public.is_admin_or_coordinator();
  v_cells uuid[] := coalesce(p_cell_ids, '{}');
  v_groups uuid[] := coalesce(p_group_ids, '{}');
  v_profiles uuid[] := coalesce(p_profile_ids, '{}');
  v_spec uuid;
  v_target uuid[];
  v_added integer := 0;
  v_removed integer := 0;
  v_blocked integer := 0;
  v_source text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_meeting_manager(p_meeting_id) then
    raise exception 'Not authorised to manage this meeting audience' using errcode = '42501';
  end if;
  if p_mode not in ('all', 'cells', 'saved_groups', 'explicit') then
    raise exception 'Unknown audience mode' using errcode = '22023';
  end if;

  if p_mode = 'all' and not v_staff then
    raise exception 'Only admins and coordinators can invite all members' using errcode = '42501';
  end if;

  if p_mode = 'saved_groups' then
    if not v_staff then
      raise exception 'Only admins and coordinators can invite a saved group' using errcode = '42501';
    end if;
    if cardinality(v_groups) = 0 then
      raise exception 'Choose at least one saved group' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_groups) g(id) where not exists (
      select 1 from public.saved_groups sg where sg.id = g.id and sg.is_active
    )) then
      raise exception 'Unknown or inactive saved group' using errcode = '22023';
    end if;
  end if;

  if p_mode = 'cells' then
    if cardinality(v_cells) = 0 then
      raise exception 'Choose at least one cell' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_cells) c(id) where not exists (select 1 from public.cells where id = c.id)) then
      raise exception 'Unknown cell' using errcode = '22023';
    end if;
    if not v_staff and exists (
      select 1 from unnest(v_cells) c(id)
      where not exists (select 1 from public.cells where id = c.id and leader_id = auth.uid())
    ) then
      raise exception 'Cell leaders can only invite members of cells they lead' using errcode = '42501';
    end if;
  end if;

  if p_mode = 'explicit' then
    if cardinality(v_profiles) = 0 then
      raise exception 'Choose at least one member' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_profiles) p(id) where not exists (
      select 1 from public.profiles where id = p.id and status = 'active'
    )) then
      raise exception 'Selected members must be active accounts' using errcode = '22023';
    end if;
    if not v_staff and exists (
      select 1 from unnest(v_profiles) p(id)
      where not exists (
        select 1 from public.profiles pr
        join public.cells c on c.id = pr.cell_id
        where pr.id = p.id and c.leader_id = auth.uid()
      )
    ) then
      raise exception 'Cell leaders can only invite members of their own cells' using errcode = '42501';
    end if;
  end if;

  v_source := case p_mode
    when 'all' then 'all'
    when 'cells' then 'cell'
    when 'saved_groups' then 'group'
    else 'member'
  end;

  insert into public.audience_specs (mode, cell_ids, group_ids, profile_ids, created_by)
  values (
    p_mode,
    case when p_mode = 'cells' then v_cells end,
    case when p_mode = 'saved_groups' then v_groups end,
    case when p_mode = 'explicit' then v_profiles end,
    auth.uid()
  )
  returning id into v_spec;

  select coalesce(array_agg(r.profile_id), '{}') into v_target from public.resolve_audience_all(v_spec) r;

  select count(*) into v_blocked
  from public.meeting_attendances ma
  where ma.meeting_id = p_meeting_id
    and ma.invited_via <> 'self'
    and ma.attendance_status in ('attended', 'absent')
    and not (ma.user_id = any(v_target));
  if v_blocked > 0 then
    raise exception '% invitee(s) have recorded attendance and cannot be removed. Mark them excused instead.', v_blocked
      using errcode = '23514';
  end if;

  select count(*) into v_added
  from unnest(v_target) t(id)
  where not exists (select 1 from public.meeting_attendances ma where ma.meeting_id = p_meeting_id and ma.user_id = t.id);

  select count(*) into v_removed
  from public.meeting_attendances ma
  where ma.meeting_id = p_meeting_id
    and ma.invited_via <> 'self'
    and not (ma.user_id = any(v_target));

  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'recipients', cardinality(v_target), 'added', v_added, 'removed', v_removed);
  end if;

  insert into public.meeting_attendances
    (meeting_id, user_id, user_name, attendance_status, invited_via, invited_by, audience_spec_id)
  select p_meeting_id, p.id, coalesce(nullif(btrim(p.full_name), ''), p.email, 'Member'), 'invited', v_source,
         auth.uid(), v_spec
  from public.profiles p
  where p.id = any(v_target)
  on conflict (meeting_id, user_id) do nothing;

  update public.meeting_attendances ma
  set audience_spec_id = v_spec,
      invited_via = v_source
  where ma.meeting_id = p_meeting_id
    and ma.invited_via <> 'self'
    and ma.user_id = any(v_target);

  delete from public.meeting_attendances ma
  where ma.meeting_id = p_meeting_id
    and ma.invited_via <> 'self'
    and not (ma.user_id = any(v_target));

  update public.meetings set audience_spec_id = v_spec where id = p_meeting_id;

  return jsonb_build_object(
    'dry_run', false,
    'recipients', cardinality(v_target),
    'added', v_added,
    'removed', v_removed,
    'audience_spec_id', v_spec
  );
end;
$$;

-- The person's own answer: confirmed or excused only. Refused once staff have recorded an outcome for the row.
create or replace function public.respond_to_meeting_invitation(p_meeting_id uuid, p_response text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
  v_name text;
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Not authorised to respond to this meeting' using errcode = '42501';
  end if;
  if p_response not in ('confirmed', 'excused') then
    raise exception 'Response must be confirmed or excused' using errcode = '22023';
  end if;
  if not public.can_view_meeting(p_meeting_id) then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Member') into v_name
  from public.profiles where id = auth.uid();

  insert into public.meeting_attendances
    (meeting_id, user_id, user_name, attendance_status, invited_via, confirmed_at)
  values (p_meeting_id, auth.uid(), v_name, p_response, 'self', now())
  on conflict (meeting_id, user_id) do update
    set attendance_status = excluded.attendance_status,
        confirmed_at = excluded.confirmed_at
    where public.meeting_attendances.attendance_status in ('invited', 'confirmed', 'excused');
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'Attendance for this meeting has already been recorded by the organisers' using errcode = '23514';
  end if;
  return p_response;
end;
$$;

-- Publishes a draft. An invite-only meeting needs at least one invitation or registration first.
create or replace function public.publish_meeting(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visibility text;
  v_published timestamptz;
  v_recipients integer;
begin
  if not public.is_meeting_manager(p_meeting_id) then
    raise exception 'Not authorised to publish this meeting' using errcode = '42501';
  end if;

  select visibility, published_at into v_visibility, v_published
  from public.meetings where id = p_meeting_id for update;

  select count(*) into v_recipients from public.meeting_attendances where meeting_id = p_meeting_id;

  if v_published is null then
    if v_visibility = 'explicit' and v_recipients = 0 then
      raise exception 'An invite-only meeting needs at least one invitee before it is published' using errcode = '23514';
    end if;
    update public.meetings set published_at = now() where id = p_meeting_id returning published_at into v_published;
  end if;

  return jsonb_build_object('published_at', v_published, 'recipients', v_recipients);
end;
$$;

revoke all on function public.set_meeting_audience(uuid, text, uuid[], uuid[], uuid[], boolean) from public, anon;
revoke all on function public.respond_to_meeting_invitation(uuid, text) from public, anon;
revoke all on function public.publish_meeting(uuid) from public, anon;
grant execute on function public.set_meeting_audience(uuid, text, uuid[], uuid[], uuid[], boolean) to authenticated;
grant execute on function public.respond_to_meeting_invitation(uuid, text) to authenticated;
grant execute on function public.publish_meeting(uuid) to authenticated;
