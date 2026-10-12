-- 047_prayer_visibility_active_author_and_cell_scope.sql
--
-- Forward-only narrowing of prayer SELECT policies (T7, and cross-cell isolation). Two policies on prayer_requests are
-- replaced. No table, column, data, or other policy changes. Earlier migrations are unchanged.
--
-- Confirmed defect (reproduced through real authenticated sessions, prayer_visibility_session_test.mjs):
--   1. prayers_shared_read did not check the author. A shared prayer stayed visible to every active member, and to
--      leadership, after its author was deactivated.
--   2. prayers_leadership_read let any cell leader read leadership prayers from every cell. That breaks cross-cell
--      isolation: a leader sees prayers from members of other cells.
--
-- After 047:
--   shared (members)      : visibility = 'shared', caller active, AUTHOR active.
--   leadership (leaders)  : visibility in ('leadership','shared'), AUTHOR active, and
--                           either staff (active admin or coordinator; any cell), or
--                           an active cell leader of the AUTHOR's cell (is_cell_leader_for_profile, same cell only).
--
-- Unchanged:
--   prayers_own (author)               active account required (F5). Owners read and write their own prayers.
--   prayers_coordinator_manage         active staff UPDATE, moderation. Staff can moderate only prayers they can read,
--                                      so an inactive author's prayers are not moderated through this policy (decision).
--   Private prayers                    visible to the author only.

drop policy if exists prayers_shared_read on public.prayer_requests;
create policy prayers_shared_read on public.prayer_requests for select
  using (
    visibility = 'shared'
    and public.is_active_member()
    and public.is_active_profile(prayer_requests.author_id)
  );

drop policy if exists prayers_leadership_read on public.prayer_requests;
create policy prayers_leadership_read on public.prayer_requests for select
  using (
    visibility in ('leadership', 'shared')
    and public.is_active_profile(prayer_requests.author_id)
    and (
      public.is_admin_or_coordinator()
      or public.is_cell_leader_for_profile(prayer_requests.author_id)
    )
  );
