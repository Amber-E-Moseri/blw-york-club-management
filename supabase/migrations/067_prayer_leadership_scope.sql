-- 067_prayer_leadership_scope.sql
-- Prayer request leadership visibility by scope. Forward-only. Replaces prayers_leadership_read (role-based).
--
-- Visibility modes (unchanged meanings):
--   private    author only (prayers_own). Not readable by leaders or staff through any policy here.
--   leadership readable by administrators and coordinators; readable by a cell leader only for an active request
--              from a member of a cell they lead, and never when the author chose to be anonymous.
--   shared     readable by every active member (prayers_shared_read, unchanged).
-- A profile role of cell_leader confers no prayer access. Staff access is the existing approved staff authority.
-- The anonymity rule is an owner-review point (recorded in docs/reconciliation-plan.md). The policy keeps anonymous rows
-- out of leader reads entirely, because author_id would otherwise identify the author.

drop policy if exists prayers_leadership_read on public.prayer_requests;

create policy prayers_leadership_staff on public.prayer_requests
  for select
  to authenticated
  using (visibility in ('leadership', 'shared') and public.is_admin_or_coordinator());

create policy prayers_leadership_cell on public.prayer_requests
  for select
  to authenticated
  using (
    visibility = 'leadership'
    and is_active
    and not is_anonymous
    and public.is_cell_leader_of_user(author_id)
  );
