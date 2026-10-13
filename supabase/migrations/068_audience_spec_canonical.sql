-- 068_audience_spec_canonical.sql
--
-- Owner workstream: Shared audience (reconciliation, forward-only)
-- Dependencies:    059 (audience_specs, saved_groups, resolve_audience), 060, 063, 064 (FKs to audience_specs),
--                  065 (grants), 066 (resolve_audience caller scope, resolve_audience_all), 067 (messages)
-- Contract ref:    docs/audience-shared-contract.md
-- Number:          PROPOSED. Agent 6 confirms the final number before merge.
--
-- Problems corrected (all verified by the baseline replay in docs/audience-shared-contract.md §9):
--   1. audience_specs held ONE mode, so "cell A plus one named person" could not be expressed.
--      Adds mode 'composite' (any union of cells, groups and people) and exclusion arrays.
--   2. Consumers used ON DELETE SET NULL. Deleting a spec turned a targeted affirmation into a fellowship-wide
--      broadcast, because NULL means broadcast. Consumers now use ON DELETE RESTRICT.
--   3. audience_specs was mutable in principle (no update policy, but a privileged role could change it after
--      content was published). A trigger now makes specs immutable.
--   4. Staff could delete saved groups. Deleting a group silently changes audiences that other specs point at, so
--      groups are archived (is_active = false) instead.
--   5. Direct INSERT on audience_specs by clients bypassed the caller-scope rules. Creation moves to
--      create_audience_spec() in 069, the only client write path.
--
-- Semantics of the canonical model (also enforced in resolve_audience_all below):
--   recipients = (include set) minus (exclude set), restricted to status = 'active', deduplicated.
--   include set by mode:
--     'all'          every active profile
--     'cells'        active profiles whose cell_id is in cell_ids
--     'saved_groups' active members of any ACTIVE group in group_ids
--     'explicit'     profile_ids (active only)
--     'composite'    union of cell_ids, group_ids and profile_ids
--   exclude set (any mode): excluded_cell_ids, excluded_group_ids, excluded_profile_ids.
--   A spec with no include is invalid. Its resolution is EMPTY, never 'all'. Empty audiences are refused on write.

-- ─── 1. Canonical spec shape ─────────────────────────────────────────────────

alter table public.audience_specs
  add column if not exists excluded_cell_ids    uuid[],
  add column if not exists excluded_group_ids   uuid[],
  add column if not exists excluded_profile_ids uuid[];

alter table public.audience_specs
  drop constraint if exists audience_specs_mode_check;

alter table public.audience_specs
  add constraint audience_specs_mode_check
    check (mode in ('all', 'cells', 'saved_groups', 'explicit', 'composite'));

alter table public.audience_specs
  drop constraint if exists audience_composite_requires_include;

alter table public.audience_specs
  add constraint audience_composite_requires_include
    check (
      mode <> 'composite'
      or (
        coalesce(cardinality(cell_ids), 0)
        + coalesce(cardinality(group_ids), 0)
        + coalesce(cardinality(profile_ids), 0)
      ) > 0
    );

-- ─── 2. Immutability ─────────────────────────────────────────────────────────

create or replace function public.audience_specs_block_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'audience specifications are immutable (spec %)', old.id using errcode = '42501';
end;
$$;

drop trigger if exists audience_specs_immutable on public.audience_specs;
create trigger audience_specs_immutable
  before update or delete on public.audience_specs
  for each row execute function public.audience_specs_block_change();

-- ─── 3. Consumers restrict deletion; a missing spec can never become a broadcast ─

alter table public.events
  drop constraint if exists events_audience_spec_id_fkey;
alter table public.events
  add constraint events_audience_spec_id_fkey
    foreign key (audience_spec_id) references public.audience_specs(id) on delete restrict;

alter table public.announcements
  drop constraint if exists announcements_audience_spec_id_fkey;
alter table public.announcements
  add constraint announcements_audience_spec_id_fkey
    foreign key (audience_spec_id) references public.audience_specs(id) on delete restrict;

alter table public.confessions
  drop constraint if exists confessions_audience_spec_id_fkey;
alter table public.confessions
  add constraint confessions_audience_spec_id_fkey
    foreign key (audience_spec_id) references public.audience_specs(id) on delete restrict;

-- ─── 4. Saved groups are archived, not deleted ───────────────────────────────

revoke delete on public.saved_groups from authenticated;

-- ─── 5. Client writes to audience_specs go through create_audience_spec() (069) ─

revoke insert on public.audience_specs from authenticated;

-- ─── 6. The one resolver (owner-only). Replaces 066's body with the canonical semantics. ─

create or replace function public.resolve_audience_all(p_spec_id uuid)
returns table(profile_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with spec as (
    select s.* from public.audience_specs s where s.id = p_spec_id
  ),
  included as (
    select p.id
    from public.profiles p, spec s
    where p.status = 'active'
      and (
        s.mode = 'all'
        or (s.mode in ('cells', 'composite') and p.cell_id = any(s.cell_ids))
        or (s.mode in ('explicit', 'composite') and p.id = any(s.profile_ids))
        or (s.mode in ('saved_groups', 'composite') and exists (
              select 1
              from public.saved_group_members sgm
              join public.saved_groups sg on sg.id = sgm.group_id
              where sgm.profile_id = p.id
                and sgm.group_id = any(s.group_ids)
                and sg.is_active = true
            ))
      )
  ),
  excluded as (
    select p.id
    from public.profiles p, spec s
    where p.cell_id = any(s.excluded_cell_ids)
       or p.id = any(s.excluded_profile_ids)
       or exists (
            select 1
            from public.saved_group_members sgm
            where sgm.profile_id = p.id
              and sgm.group_id = any(s.excluded_group_ids)
          )
  )
  select distinct i.id
  from included i
  where not exists (select 1 from excluded e where e.id = i.id)
  order by i.id;
$$;

revoke all on function public.resolve_audience_all(uuid) from public, anon, authenticated, service_role;
