-- 054_cell_leadership_assignment_only.sql
--
-- Cell-specific leadership is decided by the active account and the assignment cells.leader_id. The cell_leader role
-- label is not required to exercise permissions over an assigned cell (decision approved for this release).
--
-- Migration 049 required profiles.role = 'cell_leader' in addition to the assignment, which removed cell-leader access
-- from an active, assigned leader whose role label is 'member'. This migration corrects that, forward-only.
--
-- Unchanged, and still required:
--   * an assignment: only cells.leader_id = auth.uid() grants cell leadership. A role label alone grants nothing.
--   * an active account: is_active_member() must hold. A pending, rejected or inactive leader has no cell leadership.
--   * the scope: is_cell_leader_for_profile() works only on members of a cell the caller is assigned to lead.
--   * admin and coordinator access, through is_admin_or_coordinator(), is untouched.
--
-- Changes:
--   1. is_cell_leader_of(cell): drops the role check (049).
--   2. is_cell_leader_for_profile(target): drops the role check (049).
--   3. meetings_manage_scoped: the assigned-cell branch no longer requires the role label. The USING branch for a
--      meeting the caller created keeps the cell_leader role requirement (045). The WITH CHECK requires the caller to
--      be the creator and assigned to the cell (or admin/coordinator); the role label is not part of it.
-- Forward-only: function replacement and one policy replacement. No table, column, grant or prior migration change.

create or replace function public.is_cell_leader_of(p_cell_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select case
    when p_cell_id is null then false
    else public.is_active_member() and exists (
      select 1 from public.cells where id = p_cell_id and leader_id = auth.uid()
    )
  end
$function$;

create or replace function public.is_cell_leader_for_profile(target_user_id uuid)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.profiles target
    join public.cells c on c.id = target.cell_id
    where target.id = target_user_id
      and c.leader_id = auth.uid()
      and public.is_active_member()
  )
$function$;

drop policy if exists meetings_manage_scoped on public.meetings;
create policy meetings_manage_scoped on public.meetings
  for all to authenticated
  using (
    public.is_admin_or_coordinator()
    or public.is_cell_leader_of(cell_id)
    or (public.current_user_role() = 'cell_leader' and created_by = auth.uid())
  )
  with check (
    public.is_admin_or_coordinator()
    or (created_by = auth.uid() and public.is_cell_leader_of(cell_id))
  );
