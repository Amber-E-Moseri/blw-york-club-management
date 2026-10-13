-- 056_can_view_member_active_status.sql
--
-- can_view_member (055) restructured the function to an inline is_admin_or_coordinator() branch, removing the
-- m.status = 'active' guard that the 045 version applied to all paths through the EXISTS subquery.
-- The devotional_views_select_own_or_admin policy uses can_view_member, so coordinators and admins now see
-- devotional_view rows for pending members (visible rows = 6, expected 5; bsc_effective_rls_test A1/A2).
-- Migration 052 established the pattern: confession_declarations_read_staff adds is_active_profile(user_id) to the
-- staff read path. This migration applies the same guard to can_view_member's admin/coordinator branch.
--
-- Change: add is_active_profile(p_member_id) to the is_admin_or_coordinator() branch so that staff can_view_member
-- only for active members. The BSC leader branch's m.status = 'active' filter is unchanged.
--
-- Forward-only: function replacement. No policy, table, grant or prior migration change.

create or replace function public.can_view_member(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select public.is_active_member() and (
    p_member_id = auth.uid()
    or (public.is_admin_or_coordinator() and public.is_active_profile(p_member_id))
    or exists (
      select 1
      from public.profiles m
      join public.bscs b on b.id = m.bsc_id
      where m.id = p_member_id
        and m.status = 'active'
        and m.cell_id = b.cell_id
        and (
          public.is_bsc_leader_of(b.id)
          or public.is_cell_leader_of(b.cell_id)
        )
    )
  )
$function$;
