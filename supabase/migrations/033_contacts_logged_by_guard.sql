-- 033_contacts_logged_by_guard.sql
-- Enforce that logged_by must match the authenticated caller on every contact
-- INSERT.  Prevents a coordinator or cell leader from attributing a contact log
-- entry to another staff member (logged_by spoofing).

DROP POLICY IF EXISTS contacts_insert_scoped ON public.contacts;

CREATE POLICY contacts_insert_scoped ON public.contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    logged_by = auth.uid()
    AND (public.is_admin_or_coordinator() OR public.is_cell_leader_of(cell_id))
  );
