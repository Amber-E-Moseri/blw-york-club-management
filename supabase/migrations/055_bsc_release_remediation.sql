-- 055_bsc_release_remediation.sql
--
-- BSC release remediation, ported from fix/bsc-release-remediation (724b1e5, 052_bsc_cell_leadership_remediation.sql)
-- onto the canonical history. Forward-only: no earlier migration is edited, and the remediation branch's own
-- 045-052 files are not copied (they belong to a different history).
--
-- Approved rules implemented here:
--   * bscs.leader_id is the authoritative BSC-leadership assignment. The leader must be an active member whose
--     profile cell is the BSC's cell (write-time validation, and a read-time check so a leader who moves cells loses
--     access at once).
--   * A member's BSC must belong to the member's current cell (checked by assign_member_to_bsc).
--   * BSC roster access (bsc_members_visible, can_view_member) requires current cell membership for a BSC leader.
--   * BSC structure: admin and coordinator manage all BSCs. An active cell leader (cells.leader_id) creates and updates
--     BSCs in a cell they lead, and may not delete. Only admin and coordinator delete.
--   * A BSC that still has members cannot be deleted. The delete raises, instead of the foreign key clearing bsc_id.
--   * Roster changes go through assign_member_to_bsc only: audited, validated, and it refuses a zero-row write. No
--     profiles UPDATE policy is added for administrators.
--   * Cell leadership remains assignment-based (054). Nothing here requires the cell_leader role label.
--
-- Forward-only: function replacements, one trigger function and trigger each for leader eligibility and deletion,
-- policy replacements on bscs, one audit table and one RPC. No profile policy is added.

-- ─── 1. BSC leadership: active, assigned, and in the BSC's cell ──────────────────────────────────────────────────────

create or replace function public.is_bsc_leader_of(p_bsc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select public.is_active_member() and exists (
    select 1
    from public.bscs b
    join public.profiles me on me.id = auth.uid()
    where b.id = p_bsc_id
      and b.leader_id = auth.uid()
      and me.cell_id = b.cell_id
  )
$function$;

create or replace function public.can_view_member(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select public.is_active_member() and (
    p_member_id = auth.uid()
    or public.is_admin_or_coordinator()
    or exists (
      select 1
      from public.profiles m
      join public.bscs b on b.id = m.bsc_id
      where m.id = p_member_id
        and m.status = 'active'
        and m.cell_id = b.cell_id
        and (
          public.is_bsc_leader_of(b.id)
          or public.is_cell_leader_of(b.cell_id)
        )
    )
  )
$function$;

-- The BSC roster: a leader sees the members of a BSC only while the leader is in that BSC's cell (is_bsc_leader_of).
-- Pending members stay visible to the leader for onboarding (045, F4). The column list is unchanged.
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
    and public.is_active_member()
    and (
      public.is_admin_or_coordinator()
      or public.is_bsc_leader_of(b.id)
      or public.is_cell_leader_of(b.cell_id)
    )
  order by b.name, p.full_name
$function$;

-- ─── 2. Write-time leader eligibility (I3) ───────────────────────────────────────────────────────────────────────────

create or replace function public.guard_bsc_leader_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.leader_id is null then
    return new;
  end if;
  -- An unchanged leader and cell on an existing row is not re-validated, so existing rows are not blocked until touched.
  if tg_op = 'UPDATE'
     and new.leader_id is not distinct from old.leader_id
     and new.cell_id is not distinct from old.cell_id then
    return new;
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new.leader_id
      and p.status = 'active'
      and p.cell_id = new.cell_id
  ) then
    raise exception 'A BSC leader must be an active member of the BSC''s cell.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_bsc_leader_eligibility() from public, anon, authenticated, service_role;

drop trigger if exists bscs_guard_leader_eligibility on public.bscs;
create trigger bscs_guard_leader_eligibility
  before insert or update on public.bscs
  for each row execute function public.guard_bsc_leader_eligibility();

-- ─── 3. BSC structure policies by role (D6) ──────────────────────────────────────────────────────────────────────────

-- Replaces bscs_manage, which let an active cell leader delete a BSC.
drop policy if exists bscs_manage on public.bscs;

create policy bscs_insert_scoped on public.bscs
  for insert to authenticated
  with check (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id));

create policy bscs_update_scoped on public.bscs
  for update to authenticated
  using (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id))
  with check (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id));

create policy bscs_delete_staff on public.bscs
  for delete to authenticated
  using (public.is_admin_or_coordinator());

-- ─── 4. A BSC with members cannot be deleted ─────────────────────────────────────────────────────────────────────────

create or replace function public.guard_bsc_delete_empty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if exists (select 1 from public.profiles p where p.bsc_id = old.id) then
    raise exception 'This BSC still has members. Move them to another BSC before deleting it.' using errcode = 'P0001';
  end if;
  return old;
end;
$function$;

revoke all on function public.guard_bsc_delete_empty() from public, anon, authenticated, service_role;

drop trigger if exists bscs_guard_delete_empty on public.bscs;
create trigger bscs_guard_delete_empty
  before delete on public.bscs
  for each row execute function public.guard_bsc_delete_empty();

-- ─── 5. Audited roster changes ───────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.bsc_assignment_audit (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.profiles(id) on delete cascade,
  from_bsc_id  uuid references public.bscs(id) on delete set null,
  to_bsc_id    uuid references public.bscs(id) on delete set null,
  performed_by uuid not null references public.profiles(id) on delete restrict,
  performed_at timestamptz not null default now()
);

create index if not exists bsc_assignment_audit_member_idx on public.bsc_assignment_audit (member_id);

alter table public.bsc_assignment_audit enable row level security;

-- Staff read the audit trail. Writes happen only inside assign_member_to_bsc (security definer), so API roles
-- have no write privilege on the table.
drop policy if exists bsc_assignment_audit_read_staff on public.bsc_assignment_audit;
create policy bsc_assignment_audit_read_staff on public.bsc_assignment_audit
  for select to authenticated
  using (public.is_admin_or_coordinator());

revoke insert, update, delete on public.bsc_assignment_audit from public, anon, authenticated;
grant select on public.bsc_assignment_audit to authenticated;

-- The only supported path to change profiles.bsc_id from the app. The caller must be an active admin or coordinator.
-- The member must be active, and the BSC must belong to the member's current cell (or be null to unassign).
-- The write must touch exactly one row; a zero-row result raises, so the app cannot report a silent success.
--   42501  caller is not an active admin or coordinator
--   P0001  member not active, or the BSC is not in the member's current cell
--   P0002  member not found, or the write matched no row
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
  if v_member_status <> 'active' then
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

revoke all on function public.assign_member_to_bsc(uuid, uuid) from public, anon;
grant execute on function public.assign_member_to_bsc(uuid, uuid) to authenticated;
