-- 093_pending_applicant_cell_placement.sql
--
-- Forward-only. PROPOSED, NOT APPLIED: diff review and approval first.
--
-- Approved policy:
--   * Admins and coordinators can assign a pending applicant to a cell through an authorised, audited workflow.
--   * Pending applicants cannot place or approve themselves or gain active-member privileges.
--   * Rejecting an applicant does not erase their cell or BSC placement history (reject_pending_member is unchanged).
--
-- Why a pending applicant could not be placed before: guard_member_cell_placement (072) allows a cell only for an
-- active member, and transfer_member_cell (072) refuses anyone who is not active. So placement was impossible for an
-- applicant, and the only way a pending member could hold a cell was a direct status change, which 089 now refuses.
--
-- The change is one authorised path and one narrow exception in the guard:
--   1. assign_pending_applicant_to_cell(): the only path that places a PENDING applicant. It is SECURITY DEFINER and
--      owned by postgres. It checks the caller is an active admin or coordinator, the target is pending, the caller is
--      not the target, the target has no BSC and leads no cell, and the cell exists and is not archived. The existing
--      profiles_member_cell_audit trigger writes member_cell_audit with the caller as actor, so the change is audited.
--   2. guard_member_cell_placement(): a pending member may take a cell only when the change runs as the database
--      owner, which is the case only inside assign_pending_applicant_to_cell(). Direct placement of a pending account by
--      any authenticated or service role is refused. Active placement is unchanged (transfer_member_cell).
--
-- Unchanged: transfer_member_cell, approve_pending_member, reject_pending_member (placement history is kept), the
-- profile self-edit restrictions (cell_id is protected for non-staff in 048), and RLS. Profile RLS is not relaxed.
-- Cell leaders see a pending applicant in their own cell through profiles_select_scoped and 090; BSC-only leaders do not.
--
-- Dependencies: 072 (guard_member_cell_placement, transfer_member_cell, member_cell_audit), 083 and 089 (status
-- workflow), 090 (pending visibility).

create or replace function public.guard_member_cell_placement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.cell_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.cell_id is not distinct from old.cell_id then
    return new;
  end if;

  -- Active members may be placed by transfer_member_cell. A pending applicant may be placed only by the owner-run
  -- assign_pending_applicant_to_cell(). Any other pending placement, or any placement of another status, is refused.
  if new.status is distinct from 'active'
     and not (new.status = 'pending' and current_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only active members can be placed in a cell.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.cells c where c.id = new.cell_id and c.archived_at is not null) then
    raise exception 'This cell is archived and cannot take new members.' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

create or replace function public.assign_pending_applicant_to_cell(p_member_id uuid, p_cell_id uuid)
returns table (member_id uuid, cell_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_from_cell uuid;
  v_status    text;
  v_bsc       uuid;
  v_leads     text;
  v_archived  timestamptz;
  v_rows      int;
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to place applicants in cells.' using errcode = '42501';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'You cannot place your own account.' using errcode = '42501';
  end if;

  select p.cell_id, p.status, p.bsc_id
    into v_from_cell, v_status, v_bsc
  from public.profiles p
  where p.id = p_member_id
  for update;

  if not found then
    raise exception 'Applicant not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'This applies to pending applicants only. Use transfer_member_cell for active members.'
      using errcode = 'P0001';
  end if;
  if v_from_cell is not distinct from p_cell_id then
    raise exception 'The applicant is already in that cell.' using errcode = 'P0001';
  end if;
  if v_bsc is not null then
    raise exception 'This applicant is in a Bible Study Class. Remove them from it before changing cells.'
      using errcode = 'P0001';
  end if;

  select string_agg(c.name, ', ' order by c.name) into v_leads
  from public.cells c
  where c.leader_id = p_member_id;
  if v_leads is not null then
    raise exception 'This applicant leads %. Assign a new leader to it first.', v_leads using errcode = 'P0001';
  end if;

  if p_cell_id is not null then
    select c.archived_at into v_archived from public.cells c where c.id = p_cell_id;
    if not found then
      raise exception 'Cell not found.' using errcode = 'P0002';
    end if;
    if v_archived is not null then
      raise exception 'This cell is archived and cannot take new members.' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles p
     set cell_id = p_cell_id
   where p.id = p_member_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'The applicant''s cell was not changed.' using errcode = 'P0002';
  end if;

  return query select p_member_id, p_cell_id;
end;
$function$;

revoke all on function public.assign_pending_applicant_to_cell(uuid, uuid) from public, anon;
grant execute on function public.assign_pending_applicant_to_cell(uuid, uuid) to authenticated;
