-- 064_assignments.sql
-- Individual assignments. Forward-only. Adapted from the original lineage 062_assignments.sql.
--
-- Adaptation (security): the original let an assignee update their own assignment with a policy that checked only
-- assigned_to and status. The assignee could therefore rewrite the title, description, due date and assigned_by.
-- assignments_guard_assignee_update() now restricts assignee-only updates (not admin or coordinator) to the status
-- column. Everything else in the original is unchanged: the policies, the completed_at stamp and the grants.
-- No delete is granted, so assignments are cancelled by status, never removed.

-- 062_assignments.sql
--
-- Owner workstream: Individual Assignments
-- Dependencies:    Migration 058 (baseline), 059 (audience_specs) — no direct FK to audience_specs
-- Contract ref:    docs/ops-shared-contracts.md §6
--
-- Introduces public.assignments: individual task assignments from staff/leaders to members.
--
-- Ownership rules (from contract):
--   Create: admin, coordinator, cell_leader (leader limited to own cell's members via WITH CHECK).
--   Update status: assignee may advance own status; admin/coordinator may set any status.
--   Read: assignee sees own; admin/coordinator sees all; cell leader sees their cell's members'.
--   Delete: not permitted — use status = 'cancelled'.
--
-- Status lifecycle: pending → in_progress → completed (assignee-driven)
--                   any → cancelled (admin/coordinator only)

-- ─── 1. assignments table ────────────────────────────────────────────────────

create table if not exists public.assignments (
  id           uuid        primary key default gen_random_uuid(),
  title        text        not null check (char_length(title) >= 1),
  description  text,
  assigned_to  uuid        not null references public.profiles(id) on delete cascade,
  assigned_by  uuid        not null references public.profiles(id),
  due_date     date,
  status       text        not null default 'pending'
                             check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists assignments_assigned_to_idx on public.assignments (assigned_to);
create index if not exists assignments_assigned_by_idx on public.assignments (assigned_by);
create index if not exists assignments_status_idx      on public.assignments (status);

drop trigger if exists assignments_updated_at on public.assignments;
create trigger assignments_updated_at
  before update on public.assignments
  for each row execute function public.set_updated_at();

-- Auto-stamp completed_at when status transitions to 'completed'.
create or replace function public.assignments_completed_at_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists assignments_completed_at on public.assignments;
create trigger assignments_completed_at
  before update on public.assignments
  for each row execute function public.assignments_completed_at_stamp();

-- Cell-leader scope for an assignee. Reads the assignee's cell through a definer function, so the check does not depend
-- on whether the caller can see that profile row. The leader definition is the cell model used by is_cell_leader_of
-- (cells.leader_id), the same one the BSC policies use.
create or replace function public.is_cell_leader_of_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id and public.is_cell_leader_of(p.cell_id)
  )
$$;

revoke all on function public.is_cell_leader_of_user(uuid) from public, anon;
grant execute on function public.is_cell_leader_of_user(uuid) to authenticated;

alter table public.assignments enable row level security;

-- ─── 2. RLS policies ─────────────────────────────────────────────────────────

-- SELECT: assignee sees own; admin/coordinator sees all; cell leader sees their cell's members'.
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select
  to authenticated
  using (
    public.is_active_member()
    and (
      assigned_to = auth.uid()
      or public.is_admin_or_coordinator()
      or public.is_cell_leader_of_user(assignments.assigned_to)
    )
  );

-- INSERT: admin, coordinator, cell_leader (leader restricted to their own cell's active members).
drop policy if exists assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
  for insert
  to authenticated
  with check (
    public.is_active_member()
    and assigned_by = auth.uid()
    and public.is_active_profile(assigned_to)
    and (
      public.is_admin_or_coordinator()
      or public.is_cell_leader_of_user(assigned_to)
    )
  );

-- UPDATE: assignee may advance their own status (not cancel); admin/coordinator may set any status.
-- Implemented via two policies (RLS OR-combines them).
drop policy if exists assignments_update_own_status on public.assignments;
create policy assignments_update_own_status on public.assignments
  for update
  to authenticated
  using (
    public.is_active_member()
    and assigned_to = auth.uid()
    and status not in ('completed', 'cancelled')
  )
  with check (
    assigned_to = auth.uid()
    and status in ('pending', 'in_progress', 'completed')
  );

drop policy if exists assignments_update_manager on public.assignments;
create policy assignments_update_manager on public.assignments
  for update
  to authenticated
  using (public.is_admin_or_coordinator())
  with check (public.is_admin_or_coordinator());

-- DELETE: blocked at the policy layer — no policy permits it.
-- (No DELETE policy = no rows can be deleted by any authenticated user.)

-- ─── 3. Grants ───────────────────────────────────────────────────────────────


-- Assignees may change only their own status. Managers (admin and coordinator) may change anything the policies allow.
create or replace function public.assignments_guard_assignee_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin_or_coordinator() then
    return new;
  end if;
  if new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.due_date is distinct from old.due_date
     or new.assigned_to is distinct from old.assigned_to
     or new.assigned_by is distinct from old.assigned_by then
    raise exception 'An assignee may change only the status of an assignment.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.assignments_guard_assignee_update() from public, anon, authenticated;

drop trigger if exists assignments_guard_assignee_update on public.assignments;
create trigger assignments_guard_assignee_update
  before update on public.assignments
  for each row execute function public.assignments_guard_assignee_update();

grant select, insert, update on public.assignments to authenticated;
-- The trigger function runs from the trigger; no role needs EXECUTE on it (the original granted service_role, unused).
revoke all on function public.assignments_completed_at_stamp() from public, anon, authenticated, service_role;
