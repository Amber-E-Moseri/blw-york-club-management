-- EMERGENCY MITIGATION v2 (NOT EXECUTED). Replaces only the body of is_cell_leader_for_profile. The three call sites
-- (profiles_select_scoped, user_profiles_select_scoped, and the member_directory view) are unchanged.
-- Access is decided by the assignment (cells.leader_id = caller) and the caller being an active account, never by the role
-- label. Targets must be active: pending, rejected and inactive profiles are not returned to leaders.
-- Assigned leaders with the ordinary member role also gain the access the approved model grants them.
create or replace function public.is_cell_leader_for_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles target
    join public.cells c on c.id = target.cell_id
    where target.id = target_user_id
      and target.status = 'active'
      and c.leader_id = auth.uid()
      and exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'active')
  )
$$;
