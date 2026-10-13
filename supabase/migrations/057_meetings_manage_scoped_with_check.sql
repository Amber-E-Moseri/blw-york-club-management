-- 057_meetings_manage_scoped_with_check.sql
--
-- Migration 054 widened the USING clause of meetings_manage_scoped to allow any assigned cell leader
-- (regardless of role label) to read meetings in their cell, but left the WITH CHECK requiring
-- created_by = auth.uid(). This meant an assigned leader could read coordinator-created meetings
-- but not update them, which is inconsistent with the leadership-by-assignment model.
--
-- This migration aligns WITH CHECK with USING: an assigned leader may update any meeting in their
-- assigned cell (not only meetings they personally created). Admin/coordinator access is unchanged.
--
-- Forward-only: one policy replacement. No table, column, function, grant or prior migration change.

drop policy if exists meetings_manage_scoped on public.meetings;
create policy meetings_manage_scoped on public.meetings
  for all to authenticated
  using (
    public.is_admin_or_coordinator()
    or public.is_cell_leader_of(cell_id)
    or (public.current_user_role() = 'cell_leader' and created_by = auth.uid())
  )
  with check (
    public.is_admin_or_coordinator()
    or public.is_cell_leader_of(cell_id)
  );
