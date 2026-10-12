-- 053_bsc_leader_active.sql
--
-- BSC leadership requires an active account and an assignment (bscs.leader_id). The assignment is enforced by the
-- trigger bscs_guard_leader_assignment (049), which allows only an active account to become leader. This migration
-- adds the active check at the point of use, so a leader whose account is later rejected or set inactive loses BSC
-- access at once.
--
-- Role label is not required. An active member assigned as BSC leader keeps BSC access whatever their role is.
-- Forward-only: function replacement. Same signature and attributes as before.

create or replace function public.is_bsc_leader_of(p_bsc_id uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  select public.is_active_member() and exists (
    select 1 from public.bscs
    where id = p_bsc_id and leader_id = auth.uid()
  )
$function$;
