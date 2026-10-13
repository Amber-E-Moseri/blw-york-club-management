-- 065_audience_grants_and_policy_fixes.sql
--
-- Forward-only fixup for migrations 059 and 062.
--
-- Problems corrected:
--   1. saved_groups, saved_group_members, audience_specs and assignments have
--      no grants to service_role — migration 020's ON ALL TABLES grant is
--      point-in-time and does not cover tables created in later migrations.
--   2. saved_groups and saved_group_members only received SELECT grants for
--      authenticated; their ALL-verb manage policies also need INSERT/UPDATE/DELETE.
--   3. audience_specs INSERT policy requires an INSERT grant for authenticated.
--   4. saved_groups_read and saved_group_members_read checked only the raw JWT role
--      instead of is_active_member(), allowing pending/rejected members to read
--      saved-group data.

-- ── 1. service_role full-DML grants (bypasses RLS but still needs privilege) ─

grant select, insert, update, delete on public.saved_groups        to service_role;
grant select, insert, update, delete on public.saved_group_members to service_role;
grant select, insert, update, delete on public.audience_specs      to service_role;
grant select, insert, update, delete on public.assignments         to service_role;

-- ── 2. authenticated write grants ────────────────────────────────────────────

grant insert, update, delete on public.saved_groups        to authenticated;
grant insert, update, delete on public.saved_group_members to authenticated;
grant insert                  on public.audience_specs      to authenticated;

-- ── 3. Fix read policies ─────────────────────────────────────────────────────

drop policy if exists saved_groups_read on public.saved_groups;
create policy saved_groups_read on public.saved_groups
  for select to authenticated
  using (public.is_active_member() and is_active = true);

drop policy if exists saved_group_members_read on public.saved_group_members;
create policy saved_group_members_read on public.saved_group_members
  for select to authenticated
  using (public.is_active_member());
