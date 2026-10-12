-- 043_bsc_function_grants.sql
--
-- The schema fingerprint shows the BSC helper functions executable by anonymous users (and PUBLIC), and the
-- trigger function executable by every role. The release contract requires that anon has nothing, and trigger
-- functions are not callable by API roles (as guard_profile_privileged_columns already is).
--
-- can_view_member is still executable by authenticated, because the RLS policies that call it run as that role.

revoke execute on function public.can_view_member(uuid) from public, anon;
revoke execute on function public.is_bsc_leader_of(uuid) from public, anon;
revoke execute on function public.guard_profile_bsc_assignment() from public, anon, authenticated, service_role;

grant execute on function public.can_view_member(uuid) to authenticated;
grant execute on function public.is_bsc_leader_of(uuid) to authenticated;
