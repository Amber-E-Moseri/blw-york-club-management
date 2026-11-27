-- PROPOSED emergency mitigation (NOT EXECUTED). Replaces the two role-based profile read policies with the self-or-staff
-- policies already defined in candidate migration 070. Leaves every other policy, function and grant unchanged.
begin;
drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles for select to public
  using ((id = auth.uid()) or public.is_admin_or_coordinator());
drop policy if exists user_profiles_select_scoped on public.user_profiles;
create policy user_profiles_select_scoped on public.user_profiles for select to public
  using ((user_id = auth.uid()) or public.is_admin_or_coordinator());
commit;
