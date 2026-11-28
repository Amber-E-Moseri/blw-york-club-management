-- 066_announcements_cell_scope.sql
-- Announcement authority by scope. Forward-only. Owner decision: an active assigned cell leader may create and manage
-- announcements for their own cell. Organization-wide and cross-cell announcements need administrator or coordinator
-- authority. A profile role of cell_leader without an assignment confers no announcement management.
--
-- Changes:
--   1. announcements.cell_id (nullable). NULL means organization-wide. Existing rows keep NULL and remain staff-managed.
--      Nothing is rewritten. Historical rows written by cell_leader-role accounts are reported by
--      supabase/verification/reconciliation/leadership_inconsistency_report.sql (section E added there).
--   2. announcements_manage (role-based) is replaced by two policies: staff (all rows) and the leader of the row's cell
--      (rows with a cell_id they lead). The cell leader cannot move a row to a cell they do not lead, and cannot set NULL.
--   3. announcements_read is unchanged: active members read announcements, as before.
-- The audience of an announcement (who is notified) is a later increment (targeted communications).

alter table public.announcements add column if not exists cell_id uuid references public.cells(id) on delete set null;
create index if not exists announcements_cell_id_idx on public.announcements (cell_id);

drop policy if exists announcements_manage on public.announcements;

create policy announcements_manage_staff on public.announcements
  for all
  to authenticated
  using (public.is_admin_or_coordinator())
  with check (public.is_admin_or_coordinator());

create policy announcements_manage_cell_leader on public.announcements
  for all
  to authenticated
  using (cell_id is not null and public.is_cell_leader_of(cell_id))
  with check (cell_id is not null and public.is_cell_leader_of(cell_id));
