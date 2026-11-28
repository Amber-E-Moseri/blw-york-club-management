-- ROLLBACK (restores the catalog body of is_cell_leader_for_profile, exactly as exported).
CREATE OR REPLACE FUNCTION public.is_cell_leader_for_profile(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.profiles actor
    join public.profiles target on target.id = target_user_id
    where actor.id = auth.uid()
      and actor.status = 'active'
      and actor.role = 'cell_leader'
      and actor.cell_id is not null
      and actor.cell_id = target.cell_id
  )
$function$
