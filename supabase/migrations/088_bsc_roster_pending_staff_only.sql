-- 088_bsc_roster_pending_staff_only.sql
--
-- Forward-only. PROPOSED, NOT COMMITTED: report and approve before commit.
--
-- Approved rule: pending onboarding members stay hidden from ordinary BSC leaders. Admins and coordinators may see them.
--
-- bsc_members_visible (058) includes status = 'pending' for every caller allowed through its other branches. The
-- pending branch is reachable: a member's status can be set to 'pending' by a coordinator through a direct profile
-- update, and the cell-placement guard (072) only checks cell changes, not a status change. A pending member who keeps
-- their cell and BSC then appears in an ordinary BSC leader's roster.
--
-- This change restricts the pending branch to admins and coordinators. Active members are unchanged. The function's
-- other conditions (same cell, active caller, the three caller branches) are unchanged.
--
-- Dependencies: 058 (bsc_members_visible), 072 (cell placement guard), 083 (set_member_status transitions).

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
      or (p.status = 'pending' and public.is_admin_or_coordinator())
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
