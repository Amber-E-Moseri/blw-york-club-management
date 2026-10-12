-- 049_cell_leadership_assignment.sql
--
-- Cell leadership is the authoritative assignment cells.leader_id. Before this migration:
--   * is_cell_leader_for_profile() granted leadership when the leader's profiles.cell_id matched the target's cell_id
--     and the caller had the cell_leader role label. A profile cell membership therefore substituted for assignment.
--   * is_cell_leader_of() did not check the role label, and meetings_leaders_read() granted every cell_leader-role
--     account read access to every 'leaders' meeting in every cell (role-only, no assignment).
--
-- Changes:
--   1. A cell or BSC leader must be an active account (trigger on cells.leader_id and bscs.leader_id).
--   2. is_cell_leader_of(cell) = active caller, role 'cell_leader', and cells.leader_id = auth.uid().
--   3. is_cell_leader_for_profile(target) = active caller, role 'cell_leader', and the target's cell_id is a cell whose
--      cells.leader_id = auth.uid(). Profile cell membership of the caller plays no part.
--   4. meetings_leaders_read: admins and coordinators, or the assigned leader of the meeting's cell.
-- Admin and coordinator access is unchanged; they still pass through is_admin_or_coordinator() in every policy.
-- Forward-only: function replacement, one policy replacement, and two triggers.

-- 1. Assignment guard: the leader must be an active account. Applies to all writers, including seeds and service roles,
--    because it is a data invariant rather than an authorization check.
create or replace function public.guard_leader_assignment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.leader_id is not null
     and (tg_op = 'INSERT' or new.leader_id is distinct from old.leader_id)
     and not public.is_active_profile(new.leader_id) then
    raise exception 'Only an active account can be assigned as a leader.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- A trigger function is never called directly. Remove the default PUBLIC execute, as for guard_profile_bsc_assignment().
revoke all on function public.guard_leader_assignment() from public, anon, authenticated, service_role;

drop trigger if exists cells_guard_leader_assignment on public.cells;
create trigger cells_guard_leader_assignment
  before insert or update of leader_id on public.cells
  for each row execute function public.guard_leader_assignment();

drop trigger if exists bscs_guard_leader_assignment on public.bscs;
create trigger bscs_guard_leader_assignment
  before insert or update of leader_id on public.bscs
  for each row execute function public.guard_leader_assignment();

-- 2. Cell leadership of a cell: active, cell_leader role, and assigned.
create or replace function public.is_cell_leader_of(p_cell_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select case
    when p_cell_id is null then false
    else public.is_active_member()
      and public.current_user_role() = 'cell_leader'
      and exists (
        select 1 from public.cells where id = p_cell_id and leader_id = auth.uid()
      )
  end
$function$;

-- 3. Cell leadership of a member: the member's cell is one the caller is assigned to lead.
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
      and public.current_user_role() = 'cell_leader'
  )
$function$;

-- 4. Leaders-only meetings: staff, or the assigned leader of that meeting's cell.
drop policy if exists meetings_leaders_read on public.meetings;
create policy meetings_leaders_read on public.meetings
  for select to authenticated
  using (
    visibility = 'leaders'
    and (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id))
  );
