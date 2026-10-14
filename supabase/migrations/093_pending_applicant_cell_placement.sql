-- 093_pending_applicant_cell_placement.sql
--
-- Forward-only. PROPOSED, NOT APPLIED: diff review and approval first.
--
-- Approved policy:
--   * Admins and coordinators can assign a pending applicant to a cell through an authorised, audited workflow.
--   * Pending applicants cannot place or approve themselves or gain active-member privileges.
--   * Rejecting an applicant does not erase their cell or BSC placement history (reject_pending_member is unchanged).
--   * Every cell change, an existing administrative transfer or a pending-applicant placement, records a reason.
--
-- Why a pending applicant could not be placed before: guard_member_cell_placement (072) allows a cell only for an
-- active member, and transfer_member_cell (072) refuses anyone who is not active. So placement was impossible for an
-- applicant, and the only way a pending member could hold a cell was a direct status change, which 089 now refuses.
--
-- ─── 1. Authorised placement paths ───────────────────────────────────────────────────────────────────────────────────
--   a. assign_pending_applicant_to_cell(member, cell, reason): the only path that places a PENDING applicant. SECURITY
--      DEFINER, owned by postgres. It checks the caller is an active admin or coordinator, the target is pending, the
--      caller is not the target, the target has no BSC and leads no cell, and the cell exists and is not archived.
--   b. transfer_member_cell(member, cell, reason): the path for an ACTIVE member. Its 2-argument form (072) is kept as a
--      refusal, so no transfer is possible without a reason. The 3-argument body is otherwise unchanged from 072.
--   c. guard_member_cell_placement(): a pending member may take a cell only when the change runs as the database owner,
--      which is the case only inside assign_pending_applicant_to_cell(). Any other pending placement is refused.
--
-- ─── 2. Reason capture: exactly one audit row per cell change ───────────────────────────────────────────────────────────
--   * begin_cell_change(reason) validates the reason (3 to 500 characters after trimming) and stores it in a
--     transaction-local setting. Only the two RPCs above call it.
--   * profiles_member_cell_audit (072) fires once for each cell_id change. It writes exactly one member_cell_audit row
--     with the actor, the member, the previous cell, the destination cell, the timestamp and the reason. The RPCs
--     do not write an audit row themselves, so no duplicate is possible.
--   * The audit trigger refuses a cell_id change that has no reason. Direct owner-run writes that change a cell must
--     set the reason first. Rows written before this migration keep reason NULL. They are not rewritten.
--
-- Unchanged: approve_pending_member, reject_pending_member (placement history is kept), the profile self-edit
-- restrictions (cell_id is protected for non-staff in 048), and RLS. Profile RLS is not relaxed here (see 091).
-- Cell leaders see a pending applicant in their own cell through cell_leader_pending_roster (091), not through profiles.
--
-- Dependencies: 072 (guard_member_cell_placement, transfer_member_cell, member_cell_audit, audit_member_cell_change),
-- 083 and 089 (status workflow), 090 (status refusal), 091 (pending roster), 094 (column privileges).

-- ─── 1. Reason column on the cell audit ──────────────────────────────────────────────────────────────────────────────────

alter table public.member_cell_audit
  add column if not exists reason text
  check (reason is null or length(btrim(reason)) between 3 and 500);

-- ─── 2. Reason validation, shared by the two RPCs (internal, not granted to any API role) ───────────────────────────────

create or replace function public.begin_cell_change(p_reason text)
returns void
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Give a reason for this cell change (3 to 500 characters).' using errcode = 'P0001';
  end if;
  perform set_config('app.cell_change_reason', v_reason, true);
end;
$function$;

revoke all on function public.begin_cell_change(text) from public, anon, authenticated, service_role;

-- ─── 3. Audit trigger: one row per cell change, reason required ───────────────────────────────────────────────────────────

create or replace function public.audit_member_cell_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_reason text := nullif(btrim(current_setting('app.cell_change_reason', true)), '');
begin
  if v_reason is null then
    raise exception 'Every cell change needs a recorded reason. Use the cell administration workflow.' using errcode = 'P0001';
  end if;

  insert into public.member_cell_audit (member_id, from_cell_id, to_cell_id, actor_id, reason)
  values (new.id, old.cell_id, new.cell_id, auth.uid(), v_reason);

  -- The reason is consumed by the one row it describes. A later cell change in the same transaction must state its own
  -- reason through begin_cell_change(); it cannot reuse this one (no stale reason can leak into another change).
  perform set_config('app.cell_change_reason', '', true);
  return new;
end;
$function$;

revoke all on function public.audit_member_cell_change() from public, anon, authenticated, service_role;

-- ─── 4. Placement guard: a pending applicant only through the owner-run RPC ──────────────────────────────────────────────

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

-- ─── 5. Administrative transfer of an active member: reason required ─────────────────────────────────────────────────
--
-- The 2-argument form from 072 stays defined, so an older deployed frontend that still calls it receives a clear refusal
-- and cannot change a cell without a reason. Its body is replaced here, and it no longer changes any row. The 3-argument
-- form below is the only path that moves a member. The signature is kept deliberately; see the deployment plan.

create or replace function public.transfer_member_cell(p_member_id uuid, p_cell_id uuid)
returns table (member_id uuid, cell_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  raise exception 'Cell changes now require a reason. Reload the app and try again.' using errcode = 'P0001';
end;
$function$;

revoke all on function public.transfer_member_cell(uuid, uuid) from public, anon;
grant execute on function public.transfer_member_cell(uuid, uuid) to authenticated;

create or replace function public.transfer_member_cell(p_member_id uuid, p_cell_id uuid, p_reason text)
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
  v_rows      int;
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to move members between cells.' using errcode = '42501';
  end if;

  perform public.begin_cell_change(p_reason);

  select p.cell_id, p.status, p.bsc_id
    into v_from_cell, v_status, v_bsc
  from public.profiles p
  where p.id = p_member_id
  for update;

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  if v_from_cell is not distinct from p_cell_id then
    raise exception 'The member is already in that cell.' using errcode = 'P0001';
  end if;
  if p_cell_id is not null and v_status <> 'active' then
    raise exception 'Only active members can be placed in a cell.' using errcode = 'P0001';
  end if;
  if v_bsc is not null then
    raise exception 'This member is in a Bible Study Class. Remove them from it before changing cells.'
      using errcode = 'P0001';
  end if;

  select string_agg(c.name, ', ' order by c.name) into v_leads
  from public.cells c
  where c.leader_id = p_member_id;
  if v_leads is not null then
    raise exception 'This member leads %. Assign a new leader to it before moving them.', v_leads
      using errcode = 'P0001';
  end if;

  update public.profiles p
     set cell_id = p_cell_id
   where p.id = p_member_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'The member''s cell was not changed.' using errcode = 'P0002';
  end if;

  return query select p_member_id, p_cell_id;
end;
$function$;

revoke all on function public.transfer_member_cell(uuid, uuid, text) from public, anon;
grant execute on function public.transfer_member_cell(uuid, uuid, text) to authenticated;

-- ─── 6. Pending-applicant placement: the only path that places a pending account (reason required) ─────────────────────

create or replace function public.assign_pending_applicant_to_cell(p_member_id uuid, p_cell_id uuid, p_reason text)
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

  perform public.begin_cell_change(p_reason);

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

revoke all on function public.assign_pending_applicant_to_cell(uuid, uuid, text) from public, anon;
grant execute on function public.assign_pending_applicant_to_cell(uuid, uuid, text) to authenticated;
