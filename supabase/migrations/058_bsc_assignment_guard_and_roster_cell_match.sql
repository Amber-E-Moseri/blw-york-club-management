-- 058_bsc_assignment_guard_and_roster_cell_match.sql
--
-- Forward-only corrections confirmed by security_gap_regression_test.mjs on 057:
--
--   1. bsc_members_visible (055) showed a member through a BSC after the member had moved to another cell. The roster
--      now also requires the member's current cell to be the BSC's cell. Stale assignments left by earlier data grant
--      nothing.
--   2. guard_profile_bsc_assignment (040) let an admin or coordinator change profiles.bsc_id directly, which skipped the
--      audited assign_member_to_bsc RPC and its cell check. Only the database owner context may now change bsc_id. The
--      RPC is SECURITY DEFINER and runs as the owner, so it is the only path that passes. current_user cannot be changed
--      by a caller, so no session setting can open this path. A member cannot change cell while assigned to a BSC.
--   3. assign_member_to_bsc (055) refused to unassign a member who was no longer active, so a BSC holding that member
--      could not be emptied or deleted. Unassigning (p_bsc_id null) is now allowed for any status. Assigning still
--      requires an active member in the BSC's cell.

-- ─── 1. Roster: the member's current cell must be the BSC's cell ─────────────────────────────────────────────────────

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
  where p.status in ('active', 'pending')
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

-- ─── 2. Only the owner context (the audited RPC) may change bsc_id; a member cannot change cell while assigned ───────

create or replace function public.guard_profile_bsc_assignment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.bsc_id is distinct from old.bsc_id then
    raise exception 'BSC assignments change only through assign_member_to_bsc.' using errcode = '42501';
  end if;

  if new.cell_id is distinct from old.cell_id and old.bsc_id is not null then
    raise exception 'Remove the member from their BSC before changing their cell.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ─── 3. Unassigning is allowed for any status; assigning requires an active member in the BSC's cell ─────────────────

create or replace function public.assign_member_to_bsc(p_member_id uuid, p_bsc_id uuid)
returns table (member_id uuid, bsc_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_member_cell uuid;
  v_member_status text;
  v_old_bsc uuid;
  v_rows int;
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to change BSC assignments.' using errcode = '42501';
  end if;

  select p.cell_id, p.status, p.bsc_id
    into v_member_cell, v_member_status, v_old_bsc
  from public.profiles p
  where p.id = p_member_id;

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  if p_bsc_id is not null and v_member_status <> 'active' then
    raise exception 'Only active members can be assigned to a BSC.' using errcode = 'P0001';
  end if;
  if p_bsc_id is not null and not exists (
    select 1 from public.bscs b where b.id = p_bsc_id and b.cell_id is not distinct from v_member_cell
  ) then
    raise exception 'The BSC must belong to the member''s current cell.' using errcode = 'P0001';
  end if;

  update public.profiles p
     set bsc_id = p_bsc_id
   where p.id = p_member_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Assignment was not saved.' using errcode = 'P0002';
  end if;

  insert into public.bsc_assignment_audit (member_id, from_bsc_id, to_bsc_id, performed_by)
  values (p_member_id, v_old_bsc, p_bsc_id, auth.uid());

  return query select p_member_id, p_bsc_id;
end;
$function$;
