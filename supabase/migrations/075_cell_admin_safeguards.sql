-- 073_cell_admin_safeguards.sql
--
-- Server-side safeguards for cell administration (docs/cell-admin-schema-requirements.md). Forward-only.
-- Numbered 075: 068-070 are taken on the unified candidate (audience, targeted messages, cell-leader spec create).
-- 071-074 are claimed by audience composite, meeting publication, event read gate, and messaging correction.
--
--   1. cells_manage: admins and coordinators (active accounts only, via is_admin_or_coordinator) may create, rename,
--      assign leaders, archive and delete cells. 045 allowed coordinators only, but the cell UI lets admins manage cells.
--   2. Placement: profiles.cell_id may be set, or changed, only for an active profile and only into a cell that is not
--      archived. Pending and rejected accounts gain no cell scope.
--   3. Archive: cells.archived_at. A cell can be archived only when it has no members and no Bible Study Classes.
--      An archived cell cannot be given a leader (clearing the leader is allowed).
--   4. Delete: a cell with members or Bible Study Classes cannot be deleted. Deleting it would set profiles.cell_id to
--      null and cascade bscs rows without an audit record. Archive it instead.
--   5. Deactivation: when an active profile stops being active (pending, rejected or inactive), any cell it leads loses
--      its leader. The change is audited. The member stays in their cell and loses access through is_active_member().
--   6. Transfer RPC: transfer_member_cell(member, cell) is the authorized path for moving or removing a member. It refuses
--      a member who is in a Bible Study Class or leads a cell, and it writes one profile row in one transaction.
--   7. Audit: cell_admin_audit records each insert, update and delete of a cell. member_cell_audit records each change
--      of profiles.cell_id, whatever path made it. The staff edit audit (028) does not cover cell_id, so this closes
--      that gap. Neither audit table has a foreign key, so history survives the deletion of a cell.
--
-- Already enforced before this migration (not changed here):
--   - Leader eligibility: guard_leader_assignment (049) requires an active account on cells.leader_id.
--   - BSC consistency: guard_profile_bsc_assignment (058) refuses a cell change while the member holds a BSC.
--   - can_view_member() (056), the privacy rules of 045, and the BSC protections of 055 and 058 are untouched.

-- ─── 1. Cell management: admins and coordinators, active accounts only ────────────────────────────────────────────────

drop policy if exists cells_manage on public.cells;
create policy cells_manage on public.cells for all
  using (public.is_admin_or_coordinator()) with check (public.is_admin_or_coordinator());

-- ─── 2. Archive column ────────────────────────────────────────────────────────────────────────────────────────────────

alter table public.cells add column if not exists archived_at timestamptz null;

-- ─── 3. Placement guard on profiles.cell_id ───────────────────────────────────────────────────────────────────────────

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

  if new.status is distinct from 'active' then
    raise exception 'Only active members can be placed in a cell.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.cells c where c.id = new.cell_id and c.archived_at is not null) then
    raise exception 'This cell is archived and cannot take new members.' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_member_cell_placement() from public, anon, authenticated, service_role;

drop trigger if exists profiles_guard_member_cell_placement on public.profiles;
create trigger profiles_guard_member_cell_placement
  before insert or update of cell_id on public.profiles
  for each row execute function public.guard_member_cell_placement();

-- ─── 4. Lifecycle guard on cells: safe delete, archive rules, archived leader lock ────────────────────────────────────

create or replace function public.guard_cell_lifecycle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.profiles p where p.cell_id = old.id)
       or exists (select 1 from public.bscs b where b.cell_id = old.id) then
      raise exception 'A cell with members or Bible Study Classes cannot be deleted. Archive it instead.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    if exists (select 1 from public.profiles p where p.cell_id = new.id) then
      raise exception 'Move or remove every member before archiving this cell.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.bscs b where b.cell_id = new.id) then
      raise exception 'Remove every Bible Study Class from this cell before archiving it.' using errcode = 'P0001';
    end if;
  end if;

  if new.archived_at is not null
     and new.leader_id is not null
     and new.leader_id is distinct from old.leader_id then
    raise exception 'An archived cell cannot be given a leader. Restore the cell first.' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_cell_lifecycle() from public, anon, authenticated, service_role;

drop trigger if exists cells_guard_lifecycle on public.cells;
create trigger cells_guard_lifecycle
  before update or delete on public.cells
  for each row execute function public.guard_cell_lifecycle();

-- ─── 5. Deactivation: a profile that stops being active loses any cell it leads ───────────────────────────────────────

create or replace function public.release_cell_leadership_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if old.status = 'active' and new.status is distinct from 'active' then
    update public.cells c
       set leader_id = null
     where c.leader_id = new.id;
  end if;
  return new;
end;
$function$;

revoke all on function public.release_cell_leadership_on_deactivation() from public, anon, authenticated, service_role;

drop trigger if exists profiles_release_cell_leadership on public.profiles;
create trigger profiles_release_cell_leadership
  after update of status on public.profiles
  for each row execute function public.release_cell_leadership_on_deactivation();

-- ─── 6. Audit trail: cell changes and member cell changes ─────────────────────────────────────────────────────────────

create table if not exists public.cell_admin_audit (
  id            bigint generated always as identity primary key,
  cell_id       uuid not null,
  action        text not null check (action in ('insert', 'update', 'delete')),
  actor_id      uuid,
  before_values jsonb,
  after_values  jsonb,
  changed_at    timestamptz not null default now()
);

create index if not exists cell_admin_audit_cell_idx on public.cell_admin_audit (cell_id, changed_at desc);

alter table public.cell_admin_audit enable row level security;

drop policy if exists cell_admin_audit_read on public.cell_admin_audit;
create policy cell_admin_audit_read on public.cell_admin_audit
  for select using (public.is_admin_or_coordinator());

revoke all on table public.cell_admin_audit from anon, authenticated;
grant select on table public.cell_admin_audit to authenticated;
grant select, insert, update, delete on table public.cell_admin_audit to service_role;

create or replace function public.audit_cell_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.cell_admin_audit (cell_id, action, actor_id, before_values, after_values)
    values (new.id, 'insert', auth.uid(), null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.cell_admin_audit (cell_id, action, actor_id, before_values, after_values)
    values (new.id, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.cell_admin_audit (cell_id, action, actor_id, before_values, after_values)
    values (old.id, 'delete', auth.uid(), to_jsonb(old), null);
    return old;
  end if;
end;
$function$;

revoke all on function public.audit_cell_admin_change() from public, anon, authenticated, service_role;

drop trigger if exists cells_admin_audit on public.cells;
create trigger cells_admin_audit
  after insert or update or delete on public.cells
  for each row execute function public.audit_cell_admin_change();

create table if not exists public.member_cell_audit (
  id           bigint generated always as identity primary key,
  member_id    uuid not null,
  from_cell_id uuid,
  to_cell_id   uuid,
  actor_id     uuid,
  changed_at   timestamptz not null default now()
);

create index if not exists member_cell_audit_member_idx on public.member_cell_audit (member_id, changed_at desc);

alter table public.member_cell_audit enable row level security;

drop policy if exists member_cell_audit_read on public.member_cell_audit;
create policy member_cell_audit_read on public.member_cell_audit
  for select using (public.is_admin_or_coordinator());

revoke all on table public.member_cell_audit from anon, authenticated;
grant select on table public.member_cell_audit to authenticated;
grant select, insert, update, delete on table public.member_cell_audit to service_role;

create or replace function public.audit_member_cell_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.member_cell_audit (member_id, from_cell_id, to_cell_id, actor_id)
  values (new.id, old.cell_id, new.cell_id, auth.uid());
  return new;
end;
$function$;

revoke all on function public.audit_member_cell_change() from public, anon, authenticated, service_role;

drop trigger if exists profiles_member_cell_audit on public.profiles;
create trigger profiles_member_cell_audit
  after update of cell_id on public.profiles
  for each row when (old.cell_id is distinct from new.cell_id)
  execute function public.audit_member_cell_change();

-- ─── 7. Transfer RPC: the authorized path for moving or removing a member ─────────────────────────────────────────────

create or replace function public.transfer_member_cell(p_member_id uuid, p_cell_id uuid)
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

revoke all on function public.transfer_member_cell(uuid, uuid) from public, anon;
grant execute on function public.transfer_member_cell(uuid, uuid) to authenticated;
