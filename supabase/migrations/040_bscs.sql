-- Migration 040: Bible Study Classes (BSCs) — sub-groups within a cell
--
-- A BSC belongs to exactly one cell. Members may belong to one BSC.
-- Hierarchy: cell → bsc → member (all three layers are optional for a member).
-- Constraint: a member's bsc must belong to their cell (enforced in UI; DB relies on FK chain).

-- ─── BSCs table ───────────────────────────────────────────────────────────────

create table if not exists public.bscs (
  id         uuid        primary key default gen_random_uuid(),
  cell_id    uuid        not null references public.cells(id) on delete cascade,
  name       text        not null check (char_length(trim(name)) >= 1),
  leader_id  uuid        references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bscs_updated_at on public.bscs;
create trigger bscs_updated_at
  before update on public.bscs
  for each row execute procedure public.set_updated_at();

alter table public.bscs enable row level security;

-- All authenticated users can read BSCs
drop policy if exists bscs_read on public.bscs;
create policy bscs_read on public.bscs
  for select using (auth.role() = 'authenticated');

-- Coordinators can manage any BSC; cell leaders can manage BSCs in cells they lead
drop policy if exists bscs_manage on public.bscs;
create policy bscs_manage on public.bscs
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
    or exists (
      select 1 from public.cells c
      join public.profiles p on p.id = auth.uid()
      where c.id = bscs.cell_id and c.leader_id = auth.uid() and p.role = 'cell_leader'
    )
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
    or exists (
      select 1 from public.cells c
      join public.profiles p on p.id = auth.uid()
      where c.id = bscs.cell_id and c.leader_id = auth.uid() and p.role = 'cell_leader'
    )
  );

-- ─── BSC membership on profiles ───────────────────────────────────────────────

alter table public.profiles
  add column if not exists bsc_id uuid references public.bscs(id) on delete set null;

-- ─── Update member_directory view ─────────────────────────────────────────────
-- DROP + recreate because CREATE OR REPLACE cannot reorder or insert columns.

drop view if exists public.member_directory;

create view public.member_directory
with (security_invoker = true)
as
select
  p.id,
  p.full_name,
  case when p.id = auth.uid() or public.is_admin_or_coordinator() then p.email else null end as email,
  case when p.id = auth.uid() or public.is_admin_or_coordinator() then p.student_number else null end as student_number,
  p.role,
  p.status,
  p.cell_id,
  p.bsc_id,
  b.name as bsc_name,
  p.avatar_url,
  p.joined_at
from public.profiles p
left join public.bscs b on b.id = p.bsc_id
where
  p.id = auth.uid()
  or public.is_admin_or_coordinator()
  or public.is_cell_leader_for_profile(p.id);

grant select on public.member_directory to authenticated;
revoke insert, update, delete on public.member_directory from service_role;

-- ─── Grant table access ────────────────────────────────────────────────────────

grant select, insert, update, delete on public.bscs to authenticated;
grant select on public.bscs to service_role;
