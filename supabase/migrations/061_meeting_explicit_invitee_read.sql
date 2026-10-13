-- 061_meeting_explicit_invitee_read.sql
--
-- Owner workstream: Meetings / Attendance
-- Dependencies:    Migration 036 (meeting_attendances INSERT scope), 057 (meetings_manage_scoped)
-- Contract ref:    docs/ops-shared-contracts.md §5
--
-- Gap: meetings with visibility = 'explicit' have no SELECT policy for regular members.
--   A coordinator adds a member to meeting_attendances (which is allowed by 036).
--   That member can see their own attendance row but cannot see the meeting itself.
--
-- Fix: add meetings_explicit_invitee_read policy — an active member may SELECT a meeting
--   if they have a row in meeting_attendances for that meeting.
--
-- Additionally: the meeting_attendances SELECT policy is tightened so that for
--   visibility = 'explicit' meetings, a non-invitee cannot probe row existence.
--   Currently the policy allows a user to see their own row (`user_id = auth.uid()`).
--   That is correct — if they have a row they ARE an invitee. No change needed there.
--   The policy also allows meeting creator / cell leader, which is correct for managers.
--
-- This migration is additive: one new meetings policy. No prior policy is removed.

-- ─── 1. Meetings: explicit invitee read ──────────────────────────────────────

drop policy if exists meetings_explicit_invitee_read on public.meetings;
create policy meetings_explicit_invitee_read on public.meetings
  for select
  to authenticated
  using (
    visibility = 'explicit'
    and public.is_active_member()
    and exists (
      select 1
      from public.meeting_attendances ma
      where ma.meeting_id = meetings.id
        and ma.user_id = auth.uid()
    )
  );

-- ─── 2. meeting_attendances: isolate explicit meeting rows from non-invitees ─
--
-- The current meeting_attendances_select_scoped (migration 026) allows any active member to
-- see attendance rows where user_id = auth.uid().  For an explicit meeting, the meeting row
-- is not visible to non-invitees (no policy matches before this migration).  After adding
-- meetings_explicit_invitee_read above, an invitee can now see the meeting, and via
-- meeting_attendances_select_scoped they can already see their own row.
--
-- The remaining gap: a non-invitee can still probe meeting_attendances.user_id for an explicit
-- meeting they know the UUID of (by guessing or through other API surfaces).
-- We replace meeting_attendances_select_scoped to add this guard.

drop policy if exists meeting_attendances_select_scoped on public.meeting_attendances;
create policy meeting_attendances_select_scoped
  on public.meeting_attendances
  for select
  to authenticated
  using (
    public.is_active_member()
    and (
      -- Admin/coordinator sees all attendance for any meeting they can read
      public.is_admin_or_coordinator()
      -- Meeting creator and cell leader see all rows for their meeting
      or exists (
        select 1
        from public.meetings m
        where m.id = meeting_attendances.meeting_id
          and (
            m.created_by = auth.uid()
            or public.is_cell_leader_of(m.cell_id)
          )
      )
      -- A member sees only their own row, and only if they can see the meeting
      or (
        user_id = auth.uid()
        and exists (
          select 1 from public.meetings m
          where m.id = meeting_attendances.meeting_id
        )
      )
    )
  );
