-- 023_function_security_hardening.sql
--
-- Function audit result and enforcement.
--
-- Rules enforced here
--   * Every SECURITY DEFINER function pins search_path to "public, pg_temp" (pg_temp last, so a session cannot
--     shadow objects with temp tables).
--   * EXECUTE is revoked from PUBLIC, anon, authenticated and service_role on EVERY function in schema public,
--     then granted back only where a caller genuinely needs it (list below). A function added in the future is
--     therefore unreachable until a migration deliberately grants it; the release certification fails on any
--     function whose grants differ from this list.
--   * Trigger-only functions are callable by nobody. PostgreSQL checks EXECUTE on a trigger function when the
--     trigger is created, not when it fires, so revoking it is safe.
--
-- Intended callers
--   RPCs (SECURITY DEFINER, authorize inside)      authenticated
--     approve_pending_member(uuid), reject_pending_member(uuid), export_members_authorized(text),
--     merge_people(uuid, uuid, text)
--   Authorization helpers used by RLS policies     authenticated  (policies are evaluated as the caller)
--     current_user_role(), is_active_member(), is_coordinator(), is_admin_or_coordinator(), is_cell_leader_for_profile(uuid),
--     has_admin_permission(text), is_cell_leader_of(uuid), is_core_admin(), is_devotional_admin()
--   Identity normalizers (index expressions)       authenticated, service_role
--     normalize_identity_email(text), normalize_identity_phone(text)
--   Trigger-only                                   nobody
--     handle_new_user(), set_updated_at(), guard_profile_privileged_columns()
--   Owner-only                                     nobody (run by the database owner)
--     bootstrap_first_administrator(text, text)

-- 0. is_devotional_admin() trusted auth.jwt() -> 'user_metadata' -> 'role'. In Supabase, user_metadata is editable by
--    the signed-in user themself (auth.updateUser({ data: { role: 'admin' } })), so any member could pass this check
--    and write to the devotional-images bucket. Authorization must come from the profiles table.
create or replace function public.is_devotional_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role in ('admin', 'coordinator')
  )
$$;

-- 1. Pin search_path on every SECURITY DEFINER function.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

-- Invoker helpers that read tables are pinned too, so their behaviour never depends on the caller's search_path.
alter function public.is_cell_leader_of(uuid) set search_path = public, pg_temp;
alter function public.is_core_admin() set search_path = public, pg_temp;
alter function public.is_devotional_admin() set search_path = public, pg_temp;

-- 2. Revoke everything, then grant back explicitly.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;

grant execute on function public.approve_pending_member(uuid) to authenticated;
grant execute on function public.reject_pending_member(uuid) to authenticated;
grant execute on function public.export_members_authorized(text) to authenticated;
grant execute on function public.merge_people(uuid, uuid, text) to authenticated;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.is_coordinator() to authenticated;
grant execute on function public.is_admin_or_coordinator() to authenticated;
grant execute on function public.is_cell_leader_for_profile(uuid) to authenticated;
grant execute on function public.has_admin_permission(text) to authenticated;
grant execute on function public.is_cell_leader_of(uuid) to authenticated;
grant execute on function public.is_core_admin() to authenticated;
grant execute on function public.is_devotional_admin() to authenticated;

grant execute on function public.normalize_identity_email(text) to authenticated, service_role;
grant execute on function public.normalize_identity_phone(text) to authenticated, service_role;
