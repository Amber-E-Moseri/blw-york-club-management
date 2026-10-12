-- 051_profile_self_update_active.sql
--
-- Active members may edit their own ordinary profile fields. The only existing self-update policy
-- (profiles_self_onboarding_update, 016) covers pending accounts, so an active member had no way to edit their profile.
--
-- Protection is not relaxed by this policy. The guard trigger profiles_guard_privileged_columns (028, 048) still blocks
-- email, role, status, admin_role, cell_id, joined_at, person_id and a self-edit of any other account. The row policy
-- only admits the update to reach that trigger. Rejected and inactive accounts have no self-update path.
-- Forward-only: one policy added. No table, column, function or grant change.

drop policy if exists profiles_self_update_active on public.profiles;
create policy profiles_self_update_active on public.profiles
  for update to authenticated
  using (id = auth.uid() and status = 'active')
  with check (id = auth.uid() and status = 'active');
