-- 076_tasks_assignments_write_path.sql
--
-- Owner workstream: Unified integration (forward-only)
-- Dependencies:    062 (assignments and its RLS), 067 (trigger execute grants)
-- Ported from:     b3c57fd, section 3 only. The affirmation and saved-group parts of that migration are not included.
--
-- Problem closed: the Tasks page calls create_task_with_assignees, tasks and task_assignments, which the unified chain
-- never created. The unified model stores an assignment as one row per person in assignments (062). This migration adds
-- the three columns the Tasks page needs and one write path that creates a task in one statement.
--
-- Columns: priority (the Tasks page's four levels), batch_id (one create_assignments call is one task) and reviewed_at
-- (the review step).
--
-- create_assignments() is SECURITY INVOKER. The caller's RLS (062's assignments_insert policy) decides who may assign to
-- whom. A rejected row rolls back the whole statement, so no partial task is saved.

-- ─── 1. Assignments: priority, batch and review columns ──────────────────────────────────────────────────────────────

alter table public.assignments
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists batch_id uuid,
  add column if not exists reviewed_at timestamptz;

create index if not exists assignments_batch_idx on public.assignments (batch_id);

-- ─── 2. One task, one row per assignee, one statement ────────────────────────────────────────────────────────────────

create or replace function public.create_assignments(
  p_title        text,
  p_description  text,
  p_due_date     date,
  p_priority     text,
  p_assignee_ids uuid[]
)
returns setof uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch uuid := gen_random_uuid();
begin
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'Title is required' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Choose a priority' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_assignee_ids), 0) = 0 then
    raise exception 'Choose at least one person' using errcode = '22023';
  end if;

  return query
  with ins as (
    insert into public.assignments (title, description, assigned_to, assigned_by, due_date, priority, batch_id)
    select btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), a.id, auth.uid(), p_due_date, p_priority, v_batch
    from (select distinct unnest(p_assignee_ids) as id) a
    returning id
  )
  select ins.id from ins;
end;
$$;

revoke all on function public.create_assignments(text, text, date, text, uuid[]) from public, anon;
grant execute on function public.create_assignments(text, text, date, text, uuid[]) to authenticated;

-- ─── 3. Trigger function from 062 (ported from 067) ──────────────────────────────────────────────────────────────────
-- assignments_completed_at_stamp() is a trigger function. 062 left it executable by anon. Trigger functions run from
-- the table trigger and need no API execute grant.
revoke all on function public.assignments_completed_at_stamp() from public, anon, authenticated, service_role;
