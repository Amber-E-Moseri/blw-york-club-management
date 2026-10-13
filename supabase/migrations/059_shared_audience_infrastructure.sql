-- 059_shared_audience_infrastructure.sql
--
-- Owner workstream: Shared Audience Infrastructure
-- Dependencies:    Migration 058 (baseline)
-- Contract ref:    docs/ops-shared-contracts.md §1–3
--
-- Introduces:
--   1. public.saved_groups          — named, reusable groups of members
--   2. public.saved_group_members   — group membership
--   3. public.audience_specs        — shared audience intent for any content type
--   4. public.resolve_audience()    — RPC: expands an audience_spec to active profile IDs
--
-- Audience modes:
--   'all'          — all profiles with status = 'active'
--   'cells'        — active profiles whose cell_id is in spec.cell_ids
--   'saved_groups' — active profiles in any of spec.group_ids
--   'explicit'     — spec.profile_ids filtered to active

-- ─── 1. saved_groups ─────────────────────────────────────────────────────────

create table if not exists public.saved_groups (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (char_length(name) >= 1),
  description text,
  created_by  uuid        not null references public.profiles(id) on delete cascade,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

drop trigger if exists saved_groups_updated_at on public.saved_groups;
create trigger saved_groups_updated_at
  before update on public.saved_groups
  for each row execute function public.set_updated_at();

alter table public.saved_groups
  add column if not exists updated_at timestamptz not null default now();

alter table public.saved_groups enable row level security;

drop policy if exists saved_groups_read on public.saved_groups;
create policy saved_groups_read on public.saved_groups
  for select
  using (auth.role() = 'authenticated' and is_active = true);

drop policy if exists saved_groups_manage on public.saved_groups;
create policy saved_groups_manage on public.saved_groups
  for all
  using (public.is_admin_or_coordinator())
  with check (public.is_admin_or_coordinator());

-- ─── 2. saved_group_members ──────────────────────────────────────────────────

create table if not exists public.saved_group_members (
  group_id   uuid        not null references public.saved_groups(id) on delete cascade,
  profile_id uuid        not null references public.profiles(id) on delete cascade,
  added_by   uuid        not null references public.profiles(id),
  added_at   timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index if not exists sgm_group_idx on public.saved_group_members (group_id);
create index if not exists sgm_profile_idx on public.saved_group_members (profile_id);

alter table public.saved_group_members enable row level security;

drop policy if exists saved_group_members_read on public.saved_group_members;
create policy saved_group_members_read on public.saved_group_members
  for select
  using (auth.role() = 'authenticated');

drop policy if exists saved_group_members_manage on public.saved_group_members;
create policy saved_group_members_manage on public.saved_group_members
  for all
  using (public.is_admin_or_coordinator())
  with check (public.is_admin_or_coordinator());

-- ─── 3. audience_specs ───────────────────────────────────────────────────────

create table if not exists public.audience_specs (
  id          uuid        primary key default gen_random_uuid(),
  mode        text        not null check (mode in ('all', 'cells', 'saved_groups', 'explicit')),
  cell_ids    uuid[],
  group_ids   uuid[],
  profile_ids uuid[],
  created_by  uuid        not null references public.profiles(id),
  created_at  timestamptz not null default now(),

  -- Enforce that the right array is populated for each mode
  constraint audience_cells_requires_ids
    check (mode <> 'cells' or (cell_ids is not null and array_length(cell_ids, 1) > 0)),
  constraint audience_groups_requires_ids
    check (mode <> 'saved_groups' or (group_ids is not null and array_length(group_ids, 1) > 0)),
  constraint audience_explicit_requires_ids
    check (mode <> 'explicit' or (profile_ids is not null and array_length(profile_ids, 1) > 0))
);

alter table public.audience_specs enable row level security;

drop policy if exists audience_specs_read on public.audience_specs;
create policy audience_specs_read on public.audience_specs
  for select
  using (public.is_admin_or_coordinator());

drop policy if exists audience_specs_insert on public.audience_specs;
create policy audience_specs_insert on public.audience_specs
  for insert
  with check (public.is_admin_or_coordinator());

-- audience_specs rows are immutable after creation; updates are not permitted.

-- ─── 4. resolve_audience() RPC ───────────────────────────────────────────────

create or replace function public.resolve_audience(p_spec_id uuid)
returns table(profile_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  join public.audience_specs s on s.id = p_spec_id
  where p.status = 'active'
    and (
      s.mode = 'all'
      or (s.mode = 'cells'        and p.cell_id = any(s.cell_ids))
      or (s.mode = 'explicit'     and p.id = any(s.profile_ids))
      or (s.mode = 'saved_groups' and exists (
            select 1
            from public.saved_group_members sgm
            join public.saved_groups sg on sg.id = sgm.group_id
            where sgm.profile_id = p.id
              and sgm.group_id = any(s.group_ids)
              and sg.is_active = true
          ))
    );
$$;

revoke all on function public.resolve_audience(uuid) from public, anon;
grant execute on function public.resolve_audience(uuid) to authenticated, service_role;

-- ─── 5. Grants ───────────────────────────────────────────────────────────────

grant select on public.saved_groups        to authenticated;
grant select on public.saved_group_members to authenticated;
grant select on public.audience_specs      to authenticated;
-- Writes go through RLS; no broad INSERT/UPDATE grants.
