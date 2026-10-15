-- 035_events_created_by_guard.sql
-- GAP-1: Prevent events.created_by attribution forgery.
--
-- The previous events_manage policy allowed any admin/coordinator to set
-- created_by to an arbitrary user's ID because the WITH CHECK only verified
-- role, not identity. This migration tightens the WITH CHECK so the caller
-- must own the row: created_by = auth.uid().
--
-- USING clause is unchanged — reads remain open to all admins/coordinators.
-- UPDATE is also guarded: a coordinator can edit any event they are allowed to
-- see (USING), but the WITH CHECK ensures they cannot re-attribute it to
-- someone else after the fact.

DROP POLICY IF EXISTS events_manage ON public.events;

CREATE POLICY events_manage ON public.events
  FOR ALL
  USING (public.is_admin_or_coordinator())
  WITH CHECK (
    -- Role check: only admins and coordinators may write events.
    public.is_admin_or_coordinator()
    -- Attribution guard: created_by must always be the authenticated caller.
    -- Prevents a coordinator from creating or updating an event in another
    -- user's name (created_by spoofing / GAP-1).
    AND created_by = auth.uid()
  );
