-- 065_cell_leadership_canonical.sql
-- Canonical cell leadership. Forward-only. Decision (owner): cells.leader_id is the authoritative source of cell-specific
-- leadership. A profile role of 'cell_leader' is a general classification and confers no cell authority by itself.
--
-- Changes, each replacing a role-based check with the canonical one:
--   1. is_cell_leader_for_profile(target): was profiles.role = 'cell_leader' and the same cell. Now: the caller is an active
--      member who leads the target's cell (is_cell_leader_of). The target must not be a pending or rejected applicant (the
--      privacy rule from the original lineage). The function returns a boolean only and reads no profile fields, so it is not
--      a general profile reader. profiles_select_scoped and user_profiles_select_scoped keep calling it unchanged.
--   2. meetings_leaders_read: a 'leaders' meeting is visible to administrators, coordinators and the leader of its cell.
--   3. meetings_manage_scoped: was 'cell_leader' role and (creator or leader). Now: administrators, coordinators and the leader
--      of the meeting's cell. Creators who are no longer leaders lose management, which is the revocation rule.
--   4. respond_to_meeting_invitation: the 'leaders' visibility clause uses the same canonical check. The rest of the function
--      is copied unchanged from 046.
--
-- Not changed here, and reported for owner decision: announcements_manage and prayers_leadership_read grant access by the
-- 'cell_leader' role without a cell. Neither is cell-specific; see docs/reconciliation-plan.md section 8.
--
-- Roles and leadership assignments are not rewritten by this migration.

create or replace function public.is_cell_leader_for_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and exists (
    select 1
    from public.profiles t
    where t.id = target_user_id
      and t.status not in ('pending', 'rejected')
      and public.is_cell_leader_of(t.cell_id)
  )
$$;

drop policy if exists meetings_leaders_read on public.meetings;
create policy meetings_leaders_read on public.meetings
  for select
  to authenticated
  using (
    visibility = 'leaders'
    and (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id))
  );

drop policy if exists meetings_manage_scoped on public.meetings;
create policy meetings_manage_scoped on public.meetings
  for all
  to authenticated
  using (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id))
  with check (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id));

create or replace function public.respond_to_meeting_invitation(p_meeting_id uuid, p_response text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_rows integer;
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Not authorised to respond to this meeting.' using errcode = '42501';
  end if;
  if p_response not in ('confirmed', 'excused') then
    raise exception 'Response must be confirmed or excused.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id
      and m.published_at is not null
      and (
        m.visibility = 'public'
        or (m.visibility = 'leaders' and (public.is_admin_or_coordinator() or public.is_cell_leader_of(m.cell_id)))
        or (m.visibility = 'cell' and exists (
          select 1 from public.profiles p where p.id = auth.uid() and p.cell_id = m.cell_id
        ))
        or exists (
          select 1 from public.meeting_attendances ma
          where ma.meeting_id = m.id and ma.user_id = auth.uid()
        )
      )
  ) then
    raise exception 'Meeting not found.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Member')
    into v_name from public.profiles where id = auth.uid();

  insert into public.meeting_attendances
    (meeting_id, user_id, user_name, attendance_status, confirmed_at)
  values (p_meeting_id, auth.uid(), v_name, p_response, now())
  on conflict (meeting_id, user_id) do update
    set attendance_status = excluded.attendance_status,
        confirmed_at = excluded.confirmed_at
    where public.meeting_attendances.attendance_status in ('invited', 'confirmed', 'excused');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Attendance has already been recorded by an organiser.' using errcode = '23514';
  end if;
  return p_response;
end;
$$;
