-- ROLLBACK to the catalog text of the Production policies (exact USING expressions from the supplied export).
begin;
drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles for select to public
  using ((id = auth.uid()) or is_admin_or_coordinator() or is_cell_leader_for_profile(id));
drop policy if exists user_profiles_select_scoped on public.user_profiles;
create policy user_profiles_select_scoped on public.user_profiles for select to public
  using ((user_id = auth.uid()) or is_admin_or_coordinator() or is_cell_leader_for_profile(user_id));
commit;
