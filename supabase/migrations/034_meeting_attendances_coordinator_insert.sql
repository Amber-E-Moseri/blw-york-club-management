-- 034_meeting_attendances_coordinator_insert.sql
-- Allow coordinators and admins to insert attendance rows for any user in any
-- meeting they can manage (roster correction: recording someone who attended but
-- never self-registered).  Mirrors the existing DELETE policy shape.

DROP POLICY IF EXISTS meeting_attendances_insert_own_visible ON public.meeting_attendances;

CREATE POLICY meeting_attendances_insert_own_visible
  ON public.meeting_attendances
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_member()
    AND (
      user_id = auth.uid()
      OR public.has_admin_permission('attendance.view_all')
      OR EXISTS (
        SELECT 1
        FROM public.meetings m
        WHERE m.id = meeting_attendances.meeting_id
          AND (
            m.created_by = auth.uid()
            OR public.is_cell_leader_of(m.cell_id)
          )
      )
    )
  );
