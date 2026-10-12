-- 052_declaration_identity_privacy.sql
--
-- Confession declaration identities are visible only to the declarer and to active staff. Before this migration,
-- confession_declarations_read_scoped let every caller who passed can_view_member(user_id) read the declaration rows
-- of that member. can_view_member() includes BSC leaders and cell leaders, so a leader could read the identity of
-- each person who declared a confession.
--
-- Changes:
--   * the broad read and the scoped read policies are dropped;
--   * the declarer reads their own declarations, if active;
--   * an active admin or coordinator reads declarations of active accounts (staff access stays scoped);
--   * members and BSC leaders have no row-level access to other people's declarations. They read counts only, through
--     the confession_declaration_counts() RPC (SECURITY DEFINER, counts only, active declarers only), defined in the
--     canonical base. This migration does not change that function.
-- Forward-only: drop and recreate policies. No table, column, function or grant change.

drop policy if exists confession_declarations_read on public.confession_declarations;
drop policy if exists confession_declarations_read_scoped on public.confession_declarations;

drop policy if exists confession_declarations_read_own on public.confession_declarations;
create policy confession_declarations_read_own on public.confession_declarations
  for select to authenticated
  using (auth.uid() = user_id and public.is_active_member());

drop policy if exists confession_declarations_read_staff on public.confession_declarations;
create policy confession_declarations_read_staff on public.confession_declarations
  for select to authenticated
  using (public.is_admin_or_coordinator() and public.is_active_profile(user_id));
