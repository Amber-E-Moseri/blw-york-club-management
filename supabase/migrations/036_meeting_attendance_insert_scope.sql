-- 036_meeting_attendance_insert_scope.sql
--
-- Tightens the INSERT policy introduced in 034 (coordinator roster insertion). Review findings against 034:
--   1. The self-insert branch no longer required the meeting to be visible to the caller, so any active member
--      could register attendance for a meeting they cannot see (e.g. visibility 'leaders') and probe meeting ids.
--   2. Staff/leader inserts accepted ANY user_id, including pending, rejected and inactive accounts, and users
--      outside the leader's cell; attendance for a non-active person is meaningless and pollutes reports.
--   3. The staff branch keyed off the VIEW permission 'attendance.view_all', so a role that can only read
--      attendance could also write it.
--
-- New rule (INSERT only; SELECT/UPDATE/DELETE are unchanged):
--   * the caller is an active member AND the meeting is visible to the caller (the sub-select is RLS-filtered), AND
--   * either the caller registers themselves, OR the target is an ACTIVE account (is_active_profile(), which does not
--     depend on the caller being able to read the target's profile row) and the caller is
--       - an admin/coordinator, or
--       - the meeting creator, or
--       - the leader of the meeting's cell.
-- Duplicate rows are still prevented by the unique (meeting_id, user_id) constraint.

-- Answers only "is this account active?" so a policy can validate a roster target without exposing the profile row.
create or replace function public.is_active_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = p_user and status = 'active')
$$;

revoke all on function public.is_active_profile(uuid) from public, anon;
grant execute on function public.is_active_profile(uuid) to authenticated, service_role;

drop policy if exists meeting_attendances_insert_own_visible on public.meeting_attendances;

create policy meeting_attendances_insert_own_visible
  on public.meeting_attendances
  for insert
  to authenticated
  with check (
    public.is_active_member()
    and exists (
      select 1
      from public.meetings m
      where m.id = meeting_attendances.meeting_id
        and (
          meeting_attendances.user_id = auth.uid()
          or (
            public.is_active_profile(meeting_attendances.user_id)
            and (
              public.is_admin_or_coordinator()
              or m.created_by = auth.uid()
              or public.is_cell_leader_of(m.cell_id)
            )
          )
        )
    )
  );
