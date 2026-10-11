-- 038_bsc_hierarchy_access.sql
--
-- Fellowship → cells → BSCs (Bible Study Classes) → members.
--
-- Rules:
--   * One fellowship for now; the coordinator leads it. fellowship_id leaves room
--     for multiple fellowships later.
--   * A cell has one or more BSCs. A member belongs to at most one BSC (profiles.bsc_id).
--   * BSC leader sees their BSC's members. Cell leader sees every BSC in their cell.
--     Coordinator and admin see everything. Members see only themselves.
--   * Leaders see Rhapsody reads (devotional_views) and confessions
--     (confession_declarations) for the members they can view.
--   * Habit entries stay private to the member, plus coordinator and admin.
--   * Message of the week (weekly_messages) is separate from Rhapsody and unchanged here.

-- ─── Fellowships ─────────────────────────────────────────────────────────────

create table if not exists public.fellowships (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) >= 1),
  created_at timestamptz not null default now()
);

alter table public.fellowships enable row level security;

drop policy if exists fellowships_read on public.fellowships;
create policy fellowships_read on public.fellowships
  for select using (auth.role() = 'authenticated');

drop policy if exists fellowships_manage on public.fellowships;
create policy fellowships_manage on public.fellowships
  for all using (public.is_admin_or_coordinator())
  with check (public.is_admin_or_coordinator());

alter table public.cells
  add column if not exists fellowship_id uuid references public.fellowships(id) on delete set null;

create index if not exists cells_fellowship_idx on public.cells (fellowship_id);

-- ─── BSCs ────────────────────────────────────────────────────────────────────

create table if not exists public.bscs (
  id         uuid primary key default gen_random_uuid(),
  cell_id    uuid not null references public.cells(id) on delete cascade,
  name       text not null check (char_length(name) >= 1),
  leader_id  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bscs_cell_idx on public.bscs (cell_id);
create index if not exists bscs_leader_idx on public.bscs (leader_id);

alter table public.bscs enable row level security;

drop policy if exists bscs_read on public.bscs;
create policy bscs_read on public.bscs
  for select using (auth.role() = 'authenticated');

drop policy if exists bscs_manage on public.bscs;
create policy bscs_manage on public.bscs
  for all using (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id))
  with check (public.is_admin_or_coordinator() or public.is_cell_leader_of(cell_id));

-- One BSC per member
alter table public.profiles
  add column if not exists bsc_id uuid references public.bscs(id) on delete set null;

create index if not exists profiles_bsc_idx on public.profiles (bsc_id);

-- ─── Access helpers ──────────────────────────────────────────────────────────

create or replace function public.is_bsc_leader_of(p_bsc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bscs
    where id = p_bsc_id and leader_id = auth.uid()
  )
$$;

-- True when the caller may see this member's Rhapsody reads and confessions.
create or replace function public.can_view_member(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_member_id = auth.uid()
    or public.is_admin_or_coordinator()
    or exists (
      select 1
      from public.profiles m
      join public.bscs b on b.id = m.bsc_id
      where m.id = p_member_id
        and (b.leader_id = auth.uid() or public.is_cell_leader_of(b.cell_id))
    )
$$;

-- ─── Scoped reads for leaders ────────────────────────────────────────────────

-- Rhapsody reads: own, or any member the caller can view.
drop policy if exists devotional_views_select_own_or_admin on public.devotional_views;
create policy devotional_views_select_own_or_admin on public.devotional_views
  for select using (
    auth.uid() = member_id
    or public.is_devotional_admin()
    or public.can_view_member(member_id)
  );

-- Confessions: own, or any member the caller can view.
drop policy if exists confession_declarations_read_own on public.confession_declarations;
drop policy if exists confession_declarations_read_scoped on public.confession_declarations;
create policy confession_declarations_read_scoped on public.confession_declarations
  for select using (public.can_view_member(user_id));

-- habit_entries_admin_read (migration 017) already limits reads to the member
-- plus coordinator/admin, so leaders cannot see habits. No change needed.

-- ─── BSC assignment ──────────────────────────────────────────────────────────
-- Only coordinators and admins assign members to BSCs (including existing members,
-- who have no BSC until assigned). Members cannot move themselves.

create or replace function public.guard_profile_bsc_assignment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Backend and database-owner contexts, as in migration 022.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.bsc_id is distinct from old.bsc_id and not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to change BSC assignment.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_bsc_assignment on public.profiles;
create trigger profiles_guard_bsc_assignment
  before update on public.profiles
  for each row execute function public.guard_profile_bsc_assignment();
