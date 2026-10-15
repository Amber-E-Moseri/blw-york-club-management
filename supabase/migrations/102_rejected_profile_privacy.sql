-- 102_rejected_profile_privacy.sql
--
-- Product decision: rejected members are hidden from ordinary members and cell leaders, and stay visible to
-- administrators and coordinators. Rejected records, audit history and the rejected -> pending reopening workflow are
-- unchanged.
--
-- Defect on the 000-101 baseline (evidence: docs/release-reports/security-reconciliation-pg18, probes 16-17 and 20):
--   * profiles_select_scoped (091) lets a cell leader read any profile in their cell whose status is not 'pending'.
--     A rejected profile is therefore readable by the cell leader. member_directory is security_invoker, so it
--     inherits the same rule and exposes the rejected row as well.
--   * user_profiles_select_scoped (091) has the same leader branch, excluding only pending profiles.
--
-- Fix: the cell-leader branch of both policies also excludes rejected profiles. Nothing else changes:
--   * An ordinary member still sees only their own profile (no branch for other members).
--   * A rejected member still sees their own profile and their own user_profiles row (the self branch is unchanged).
--   * Administrators and coordinators still see every profile, including rejected ones (the staff branch is unchanged).
--   * Rejected -> pending reopening (set_member_status, 083) and approve/reject (016) are functions, not policies, and
--     are untouched. A reopened account becomes pending, which leaders already cannot see.
--   * No new function, table, grant or column is introduced, so the schema contract's function and table inventories
--     are unchanged. Only the predicate text of these two policies changes.
--   * member_directory (016) is security_invoker, so it inherits the profiles rule and needs no change of its own.
--
-- The subqueries below read profiles under the caller's RLS. A leader sees a profile only when it is active or
-- inactive (never pending or rejected), so the EXISTS is false for a rejected or pending profile and true for the
-- others; the leader's cell condition is unchanged.

drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles
  for select
  using (
    id = auth.uid()
    or public.is_admin_or_coordinator()
    or (
      public.is_cell_leader_for_profile(id)
      and profiles.status is distinct from 'pending'
      and profiles.status is distinct from 'rejected'
    )
  );

drop policy if exists user_profiles_select_scoped on public.user_profiles;
create policy user_profiles_select_scoped on public.user_profiles
  for select
  using (
    user_id = auth.uid()
    or public.is_admin_or_coordinator()
    or (
      public.is_cell_leader_for_profile(user_id)
      and exists (
        select 1
        from public.profiles p
        where p.id = user_profiles.user_id
          and p.status is distinct from 'pending'
          and p.status is distinct from 'rejected'
      )
    )
  );
