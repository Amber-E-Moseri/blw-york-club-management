-- 081_assignment_assignee_guard.sql
--
-- Forward-only. Closes two gaps in the assignment update rules (062 and 076).
--
-- 062's assignee policy allows an assignee to update their own row, but its WITH CHECK only pins assigned_to and the
-- allowed statuses. Two things it did not stop:
--   1. An assignee could rewrite the task itself (title, description, due date, priority, batch) on their own row.
--   2. An assignee could stamp reviewed_at on their own row, so a member could mark their own task reviewed.
--      Review is a manager step (076: reviewed_at is set by the review action, which only managers may take).
--
-- The fix is a guard trigger, not a policy change. For anyone who is not an admin or coordinator, the row may change
-- only in status (the progress the Tasks page records). Managers keep every column they had. RLS is unchanged.
--
-- Dependencies: 062 (assignments and its policies), 076 (reviewed_at, batch_id).

create or replace function public.assignments_guard_assignee_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
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

drop trigger if exists assignments_guard_assignee_changes on public.assignments;
create trigger assignments_guard_assignee_changes
  before update on public.assignments
  for each row execute function public.assignments_guard_assignee_changes();
