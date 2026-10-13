-- 065_audience_grants_and_policy_fixes.sql
--
-- Forward-only fixup for migration 059.
--
-- Problems corrected:
--   1. saved_groups and saved_group_members only received SELECT grants; their
--      ALL-verb manage policies require INSERT/UPDATE/DELETE to function.
--   2. audience_specs INSERT policy requires an INSERT grant to fire.
--   3. saved_groups_read and saved_group_members_read checked only the raw JWT role
--      instead of is_active_member(), allowing pending/rejected members to read
--      saved-group data.

-- ── 1. Write grants ──────────────────────────────────────────────────────────

grant insert, update, delete on public.saved_groups        to authenticated;
grant insert, update, delete on public.saved_group_members to authenticated;
grant insert                  on public.audience_specs      to authenticated;

-- ── 2. Fix read policies ─────────────────────────────────────────────────────

drop policy if exists saved_groups_read on public.saved_groups;
create policy saved_groups_read on public.saved_groups
  for select to authenticated
  using (public.is_active_member() and is_active = true);

drop policy if exists saved_group_members_read on public.saved_group_members;
create policy saved_group_members_read on public.saved_group_members
  for select to authenticated
  using (public.is_active_member());
