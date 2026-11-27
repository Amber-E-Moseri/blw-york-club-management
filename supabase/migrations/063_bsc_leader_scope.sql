-- 063_bsc_leader_scope.sql
-- Scoped BSC leadership helper. Forward-only. Adds is_bsc_leader_of(uuid), which the roster and pending-visibility
-- policies of the original lineage (088, 091) depend on. Taken from the original lineage's latest definition (055):
-- the caller must be an active member, must be the BSC's leader, and must belong to the BSC's cell. The definition here
-- is an exact copy of that body; only the migration context is new. No table, policy or data change.
--
-- Not restored: the original 040 helper, which checked the leader only (no active or cell check).

create or replace function public.is_bsc_leader_of(p_bsc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select public.is_active_member() and exists (
    select 1
    from public.bscs b
    join public.profiles me on me.id = auth.uid()
    where b.id = p_bsc_id
      and b.leader_id = auth.uid()
      and me.cell_id = b.cell_id
  )
$function$;

revoke all on function public.is_bsc_leader_of(uuid) from public, anon;
grant execute on function public.is_bsc_leader_of(uuid) to authenticated;
