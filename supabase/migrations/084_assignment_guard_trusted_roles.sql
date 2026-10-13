-- 084_assignment_guard_trusted_roles.sql
--
-- Forward-only correction to assignments_guard_assignee_changes() (081). 081 may already be deployed, so it is replaced
-- here, not edited.
--
-- 081 has no exemption for trusted database roles. It decides "manager" from is_admin_or_coordinator(), which reads the
-- caller's profile. A trusted role such as service_role or the database owner has no profile, so the guard treated it
-- as an assignee and refused legitimate maintenance (for example a backfill or a repair run from the SQL editor).
--
-- The exemption is the same one 048 uses for profile privileges: current_user in ('postgres', 'supabase_admin',
-- 'service_role'). It is safe because current_user is the database role the statement runs as. A client cannot change it:
-- PostgREST runs client requests as 'authenticated' or 'anon', and a JWT's role claim is not a database role. The
-- authorization for clients is unchanged: a client who is not an active admin or coordinator may change only the status
-- of an assignment, and only through the policies in 062.
--
-- Nothing else changes: the same columns are locked, the same row is checked, the trigger is not moved or renamed.
--
-- Dependencies: 062 (assignments and its policies), 076 (reviewed_at, batch_id), 081 (the function being replaced),
-- 048 (the trusted-role pattern this follows).

create or replace function public.assignments_guard_assignee_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if public.is_admin_or_coordinator() then
    return new;
  end if;
  if new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.due_date is distinct from old.due_date
     or new.priority is distinct from old.priority
     or new.assigned_to is distinct from old.assigned_to
     or new.assigned_by is distinct from old.assigned_by
     or new.batch_id is distinct from old.batch_id
     or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Only a coordinator or admin can change a task’s details or its review.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.assignments_guard_assignee_changes() from public, anon, authenticated, service_role;
