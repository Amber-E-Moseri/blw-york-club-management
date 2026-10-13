-- 090_bsc_pending_visibility_policy.sql
--
-- Forward-only. PROPOSED, NOT APPLIED: diff review and approval first.
--
-- Approved policy for pending onboarding members:
--   * Admins and coordinators see pending members.
--   * Cell leaders see pending members assigned to their own cell (and only that cell).
--   * BSC-only leaders do not see pending members.
--   * Ordinary members do not see other pending members.
--   * A pending member sees their own onboarding row (profiles_select_scoped, unchanged).
--
-- 088 restricted the pending branch to admins and coordinators, which also hid pending members from cell leaders of
-- their own cell. This corrects that. The cell-leader branch is scoped by is_cell_leader_of(b.cell_id), which is true
-- only for an active caller who leads that exact cell. The same-cell join keeps the row on the leader's own cell.
--
-- Unchanged: active-member visibility, the same-cell join, the caller gate (is_active_member), the self exclusion,
-- and the three caller branches (admin or coordinator, BSC leader of the BSC, cell leader of the cell).
-- A person who is both a BSC leader and a cell leader sees a pending member only where the member's cell is the
-- leader's cell, because the pending branch requires is_cell_leader_of(b.cell_id) for that row.
--
-- Dependencies: 054 (is_cell_leader_of), 055 (is_bsc_leader_of), 058 (membership gate), 088 (the function replaced here).

create or replace function public.bsc_members_visible()
returns table (id uuid, full_name text, email text, bsc_id uuid, bsc_name text, cell_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select p.id, p.full_name, p.email, p.bsc_id, b.name, b.cell_id
  from public.profiles p
  join public.bscs b on b.id = p.bsc_id
  where (
      p.status = 'active'
      or (
        p.status = 'pending'
        and (
          public.is_admin_or_coordinator()
          or public.is_cell_leader_of(b.cell_id)
        )
      )
    )
    and p.id <> auth.uid()
    and p.cell_id is not distinct from b.cell_id
    and public.is_active_member()
    and (
      public.is_admin_or_coordinator()
      or public.is_bsc_leader_of(b.id)
      or public.is_cell_leader_of(b.cell_id)
    )
  order by b.name, p.full_name
$function$;
