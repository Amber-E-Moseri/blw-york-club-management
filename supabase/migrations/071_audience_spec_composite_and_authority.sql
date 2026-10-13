-- 071_audience_spec_composite_and_authority.sql
--
-- Owner workstream: Shared audience (reconciliation port, forward-only)
-- Dependencies:    059 (audience_specs, saved_groups), 066 (resolve_audience), 068 (resolve_audience_all scope,
--                  FKs restrict, saved-group read policies), 070 (audience_specs_insert policy, dropped here).
-- Source:          integration/blwyork-audience-reconcile 24f0b8f, migrations 068 (spec) and 069 (create only).
--                  Renumbered: the reconciliation branch's 068/069 are NOT imported.
--
-- What this adds to the unified candidate:
--   1. Specs may be composite (any union of cells, groups and people) and may carry exclusions.
--   2. audience_specs is immutable: no client update or delete, and a trigger refuses both for every role.
--   3. Every client write goes through create_audience_spec(). The direct INSERT policy from 070 is dropped, and
--      INSERT is revoked, so there is one authority for who may create which audience.
--   4. resolve_audience_all() implements the canonical rule: include set by mode, minus exclusions, active only,
--      deduplicated. It stays owner-only.
--   5. saved_groups may not be deleted by clients (archive with is_active = false).
--   6. create_saved_group(): one atomic staff create for a group and its members.

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


-- ─── 4. Saved groups are archived, not deleted ───────────────────────────────

revoke delete on public.saved_groups from authenticated;

-- ─── 5. Single write path for specs ──────────────────────────────────────────

drop policy if exists audience_specs_insert on public.audience_specs;
revoke insert on public.audience_specs from authenticated;

-- ─── 6. The one resolver (owner-only). Canonical semantics: include by mode, minus exclusions. ─

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

-- ─── 7. create_audience_spec(): the only client write path ─────────────────────


create or replace function public.create_audience_spec(
  p_mode                 text,
  p_cell_ids             uuid[] default null,
  p_group_ids            uuid[] default null,
  p_profile_ids          uuid[] default null,
  p_excluded_cell_ids    uuid[] default null,
  p_excluded_group_ids   uuid[] default null,
  p_excluded_profile_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spec    uuid := gen_random_uuid();
  v_staff   boolean := public.is_admin_or_coordinator();
  v_has_ex  boolean;
  v_includes integer;
  v_count   integer;
begin
  if not public.is_active_member() then
    raise exception 'audience: caller is not an active member' using errcode = '42501';
  end if;

  if p_mode not in ('all', 'cells', 'saved_groups', 'explicit', 'composite') then
    raise exception 'audience: unknown mode' using errcode = '22023';
  end if;

  v_has_ex := coalesce(cardinality(p_excluded_cell_ids), 0)
            + coalesce(cardinality(p_excluded_group_ids), 0)
            + coalesce(cardinality(p_excluded_profile_ids), 0) > 0;

  if not v_staff then
    -- Cell leaders: one cell they lead, no other kinds, no exclusions.
    if p_mode <> 'cells'
       or coalesce(cardinality(p_cell_ids), 0) <> 1
       or coalesce(cardinality(p_group_ids), 0) > 0
       or coalesce(cardinality(p_profile_ids), 0) > 0
       or v_has_ex
       or not exists (select 1 from public.cells c where c.id = p_cell_ids[1] and c.leader_id = auth.uid()) then
      raise exception 'audience: outside caller scope' using errcode = '42501';
    end if;
  end if;

  v_includes := coalesce(cardinality(p_cell_ids), 0)
              + coalesce(cardinality(p_group_ids), 0)
              + coalesce(cardinality(p_profile_ids), 0);

  -- Each mode names exactly the kinds it uses. A mismatch is refused rather than silently ignored.
  if (p_mode = 'all' and v_includes > 0)
     or (p_mode = 'cells' and (coalesce(cardinality(p_cell_ids), 0) = 0 or coalesce(cardinality(p_group_ids), 0) + coalesce(cardinality(p_profile_ids), 0) > 0))
     or (p_mode = 'saved_groups' and (coalesce(cardinality(p_group_ids), 0) = 0 or coalesce(cardinality(p_cell_ids), 0) + coalesce(cardinality(p_profile_ids), 0) > 0))
     or (p_mode = 'explicit' and (coalesce(cardinality(p_profile_ids), 0) = 0 or coalesce(cardinality(p_cell_ids), 0) + coalesce(cardinality(p_group_ids), 0) > 0))
     or (p_mode = 'composite' and v_includes = 0) then
    raise exception 'audience: include kinds do not match the mode' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(coalesce(p_cell_ids, '{}'::uuid[]) || coalesce(p_excluded_cell_ids, '{}'::uuid[])) as c(id)
             where not exists (select 1 from public.cells where cells.id = c.id)) then
    raise exception 'audience: unknown cell' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_group_ids, '{}'::uuid[]) || coalesce(p_excluded_group_ids, '{}'::uuid[])) as g(id)
             where not exists (select 1 from public.saved_groups sg where sg.id = g.id and sg.is_active)) then
    raise exception 'audience: unknown or archived saved group' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_profile_ids, '{}'::uuid[]) || coalesce(p_excluded_profile_ids, '{}'::uuid[])) as p(id)
             where not exists (select 1 from public.profiles where profiles.id = p.id)) then
    raise exception 'audience: unknown person' using errcode = '22023';
  end if;

  insert into public.audience_specs (
    id, mode, cell_ids, group_ids, profile_ids,
    excluded_cell_ids, excluded_group_ids, excluded_profile_ids, created_by
  ) values (
    v_spec, p_mode,
    case when p_mode in ('cells', 'composite') then nullif(p_cell_ids, '{}') end,
    case when p_mode in ('saved_groups', 'composite') then nullif(p_group_ids, '{}') end,
    case when p_mode in ('explicit', 'composite') then nullif(p_profile_ids, '{}') end,
    nullif(p_excluded_cell_ids, '{}'), nullif(p_excluded_group_ids, '{}'), nullif(p_excluded_profile_ids, '{}'),
    auth.uid()
  );

  -- Refuse a spec that can never reach anyone. This rolls back the insert above.
  select count(*) into v_count from public.resolve_audience_all(v_spec);
  if v_count = 0 then
    raise exception 'audience: selection resolves to no active members' using errcode = '22023';
  end if;

  return v_spec;
end;
$$;


revoke all on function public.create_audience_spec(text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.create_audience_spec(text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]) to authenticated;

-- ─── 8. Saved groups: one atomic create for staff ────────────────────────────
-- The UI creates a group and its members in one call. Only active profiles may be added, and an unknown or inactive
-- id fails the whole call (nothing is half-created).

create or replace function public.create_saved_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group uuid := gen_random_uuid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_count integer;
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'saved groups are managed by coordinators' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'group name must be 1 to 120 characters' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_member_ids, '{}'::uuid[])) as m(id)
    where not exists (select 1 from public.profiles p where p.id = m.id and p.status = 'active')
  ) then
    raise exception 'every member must be an active profile' using errcode = '22023';
  end if;

  insert into public.saved_groups (id, name, created_by, is_active)
  values (v_group, v_name, auth.uid(), true);

  insert into public.saved_group_members (group_id, profile_id, added_by)
  select v_group, m.id, auth.uid()
  from (select distinct unnest(coalesce(p_member_ids, '{}'::uuid[])) as id) m;

  get diagnostics v_count = row_count;
  return v_group;
end;
$$;

revoke all on function public.create_saved_group(text, uuid[]) from public, anon;
grant execute on function public.create_saved_group(text, uuid[]) to authenticated;
