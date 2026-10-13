-- 076_unified_write_paths.sql
--
-- Owner workstream: Unified integration (forward-only)
-- Dependencies:    059 (saved_groups, saved_group_members), 062 (assignments and its RLS), 063 (confessions and
--                  audience_spec_id), 072 to 075 (cell safeguards, canonical specs, snapshots)
--
-- Problem closed: the unified UI calls RPCs and tables that the unified chain never created:
--   create_affirmation, create_saved_audience_group, saved_audience_groups   (affirmations and saved groups)
--   create_task_with_assignees, tasks, task_assignments                       (assignments)
-- Those names came from an older lineage (c596114). The unified model stores an affirmation in confessions with an
-- audience_spec_id (063), a saved group in saved_groups (059) and an assignment as one row per person in
-- assignments (062). These functions write the unified tables in one statement or one transaction each.
--
-- 076 also adds three columns to assignments: priority, batch_id (one assignment call is one task for the Tasks page)
-- and reviewed_at (the review step). They keep the Tasks page's features on the unified table.
--
-- Every function is SECURITY INVOKER. The caller's RLS is the authority, and the audience scope checks run in
-- create_audience_spec() (075), which is the only client write path for audience specs. No function here grants any
-- access that the underlying table policies do not already grant.

-- ─── 1. Saved groups: staff create a group and its members in one transaction ───────────────────────────────────────

create or replace function public.create_saved_group(p_name text, p_member_ids uuid[] default '{}')
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group uuid;
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to create saved groups' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Name the group' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_member_ids), 0) = 0 then
    raise exception 'Choose at least one person' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_member_ids) m(id)
    where not exists (select 1 from public.profiles pr where pr.id = m.id)
  ) then
    raise exception 'Unknown person in this group' using errcode = '22023';
  end if;

  insert into public.saved_groups (name, created_by)
  values (btrim(p_name), auth.uid())
  returning id into v_group;

  insert into public.saved_group_members (group_id, profile_id, added_by)
  select v_group, m.id, auth.uid()
  from (select distinct unnest(p_member_ids) as id) m
  on conflict (group_id, profile_id) do nothing;

  return v_group;
end;
$$;

revoke all on function public.create_saved_group(text, uuid[]) from public, anon;
grant execute on function public.create_saved_group(text, uuid[]) to authenticated;

-- ─── 2. Targeted affirmation: the spec and the row in one transaction ───────────────────────────────────────────────

-- p_mode 'all' with no exclusions is a broadcast: audience_spec_id stays NULL, which is the only broadcast marker
-- (063, 075). Every other selection creates an immutable spec and a frozen snapshot in the same transaction. An
-- audience that resolves to nobody raises inside create_audience_spec() or the snapshot trigger, and nothing is saved.
create or replace function public.create_targeted_affirmation(
  p_title                text,
  p_body                 text,
  p_scheduled_date       date,
  p_mode                 text,
  p_cell_ids             uuid[] default null,
  p_group_ids            uuid[] default null,
  p_profile_ids          uuid[] default null,
  p_excluded_cell_ids    uuid[] default null,
  p_excluded_group_ids   uuid[] default null,
  p_excluded_profile_ids uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_spec uuid;
  v_id   uuid;
  v_has_exclusions boolean :=
    coalesce(cardinality(p_excluded_cell_ids), 0)
    + coalesce(cardinality(p_excluded_group_ids), 0)
    + coalesce(cardinality(p_excluded_profile_ids), 0) > 0;
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to publish affirmations' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 or char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Title and body are required' using errcode = '22023';
  end if;
  if p_scheduled_date is null then
    raise exception 'Choose a date' using errcode = '22023';
  end if;

  if p_mode = 'all' and not v_has_exclusions then
    v_spec := null;
  else
    v_spec := public.create_audience_spec(
      p_mode, p_cell_ids, p_group_ids, p_profile_ids,
      p_excluded_cell_ids, p_excluded_group_ids, p_excluded_profile_ids
    );
  end if;

  insert into public.confessions (title, body, scheduled_date, created_by, audience_spec_id)
  values (btrim(p_title), btrim(p_body), p_scheduled_date, auth.uid(), v_spec)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_targeted_affirmation(text, text, date, text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[])
  from public, anon;
grant execute on function public.create_targeted_affirmation(text, text, date, text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[])
  to authenticated;

-- ─── 3. Assignments: one task per call, one row per assignee, in one statement ───────────────────────────────────────

alter table public.assignments
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists batch_id uuid,
  add column if not exists reviewed_at timestamptz;

create index if not exists assignments_batch_idx on public.assignments (batch_id);

-- 062's assignments_insert policy decides who may assign to whom (admin and coordinator: anyone; a leader: members of
-- the cells they lead). A rejected row rolls back the whole statement, so no partial task is saved.
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
