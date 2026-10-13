-- 075_audience_snapshots_and_visibility.sql (ported from integration/blwyork-audience-reconcile 069; renumbered)
--
-- Owner workstream: Shared audience (reconciliation, forward-only)
-- Dependencies:    073 (canonical spec, immutability, resolve_audience_all), 074 (is_meeting_manager and
--                  is_meeting_participant), 017 (events, confessions), 031, 035
--                  (events_manage), 063 (confessions_read, can_see_affirmation), 064 (announcements policies)
-- Contract ref:    docs/audience-shared-contract.md
-- Number:          075 (ported from integration/blwyork-audience-reconcile 069; renumbered after 074).
--
-- Decisions implemented here:
--   * Targeted announcements, affirmations and events take a FROZEN recipient snapshot when they are inserted.
--     Visibility and notification read the snapshot, never a live re-resolution. A person who joins a group or
--     cell after publication does not gain access to earlier targeted content, and a person who leaves keeps the
--     access they were given (they still stop seeing it once they are not an active member).
--   * A targeted row whose audience resolves to nobody is refused (the insert fails). It cannot become a
--     broadcast. Broadcast is only spec NULL, and only staff can write that.
--   * Cell leaders may target ONLY their own cell, with a single-cell spec. They cannot post broadcasts.
--   * Audience specs are created only through create_audience_spec(), which applies the caller-scope rules.
--   * Targeted content's audience cannot be changed after insert.

-- ─── 1. Snapshot tables ──────────────────────────────────────────────────────

create table if not exists public.audience_publications (
  id              uuid        primary key default gen_random_uuid(),
  content_type    text        not null check (content_type in ('announcement', 'affirmation', 'event')),
  content_id      uuid        not null,
  spec_id         uuid        not null references public.audience_specs(id) on delete restrict,
  published_by    uuid        references public.profiles(id) on delete restrict,
  recipient_count integer     not null check (recipient_count > 0),
  created_at      timestamptz not null default now(),
  unique (content_type, content_id)
);

create table if not exists public.audience_snapshots (
  publication_id uuid not null references public.audience_publications(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete restrict,
  primary key (publication_id, profile_id)
);

create index if not exists audience_snapshots_profile_idx on public.audience_snapshots (profile_id);

alter table public.audience_publications enable row level security;
alter table public.audience_snapshots    enable row level security;

drop policy if exists audience_publications_select on public.audience_publications;
create policy audience_publications_select on public.audience_publications
  for select to authenticated
  using (public.is_admin_or_coordinator());

drop policy if exists audience_snapshots_select on public.audience_snapshots;
create policy audience_snapshots_select on public.audience_snapshots
  for select to authenticated
  using (
    public.is_admin_or_coordinator()
    or (profile_id = auth.uid() and public.is_active_member())
  );

-- No client write policy or grant exists for either table. Writes happen only in audience_snapshot_content().
grant select on public.audience_publications to authenticated;
grant select on public.audience_snapshots    to authenticated;
grant select, insert, update, delete on public.audience_publications, public.audience_snapshots to service_role;

-- ─── 2. Authority helpers ────────────────────────────────────────────────────

-- May the caller target this spec? Staff: any spec. Cell leader: only a single-cell spec for a cell they lead.
-- Reads the spec without relying on audience_specs RLS (which is staff-only), so leaders can be checked.
create or replace function public.audience_caller_can_target(p_spec_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and (
    public.is_admin_or_coordinator()
    or exists (
      select 1
      from public.audience_specs s
      where s.id = p_spec_id
        and s.mode = 'cells'
        and cardinality(s.cell_ids) = 1
        and coalesce(cardinality(s.group_ids), 0) = 0
        and coalesce(cardinality(s.profile_ids), 0) = 0
        and coalesce(cardinality(s.excluded_cell_ids), 0) = 0
        and coalesce(cardinality(s.excluded_group_ids), 0) = 0
        and coalesce(cardinality(s.excluded_profile_ids), 0) = 0
        and exists (
          select 1 from public.cells c
          where c.id = s.cell_ids[1]
            and c.leader_id = auth.uid()
        )
    )
  )
$$;

-- Is the caller a recipient of this targeted item? Reads the frozen snapshot only.
create or replace function public.is_audience_recipient(p_content_type text, p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and exists (
    select 1
    from public.audience_publications p
    join public.audience_snapshots s on s.publication_id = p.id
    where p.content_type = p_content_type
      and p.content_id = p_content_id
      and s.profile_id = auth.uid()
  )
$$;

-- ─── 3. Snapshot writer (internal; called only by the triggers below) ─────────

create or replace function public.audience_snapshot_content(
  p_content_type text,
  p_content_id   uuid,
  p_spec_id      uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_publication uuid;
  v_count       integer;
begin
  insert into public.audience_publications (content_type, content_id, spec_id, published_by, recipient_count)
  values (p_content_type, p_content_id, p_spec_id, auth.uid(), 1)
  returning id into v_publication;

  insert into public.audience_snapshots (publication_id, profile_id)
  select v_publication, r.profile_id from public.resolve_audience_all(p_spec_id) as r(profile_id);

  get diagnostics v_count = row_count;

  -- An audience that resolves to nobody is an error. The insert that caused it is rolled back.
  if v_count = 0 then
    raise exception 'audience resolves to no active members; content not saved' using errcode = '22023';
  end if;

  update public.audience_publications set recipient_count = v_count where id = v_publication;
end;
$$;

revoke all on function public.audience_snapshot_content(text, uuid, uuid) from public, anon, authenticated;

-- ─── 4. Triggers: snapshot on insert, immutable audience afterwards ───────────

create or replace function public.snapshot_announcement_audience()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.audience_snapshot_content('announcement', new.id, new.audience_spec_id);
  return new;
end;
$$;

create or replace function public.snapshot_affirmation_audience()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.audience_snapshot_content('affirmation', new.id, new.audience_spec_id);
  return new;
end;
$$;

create or replace function public.snapshot_event_audience()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.audience_snapshot_content('event', new.id, new.audience_spec_id);
  return new;
end;
$$;

create or replace function public.block_targeted_audience_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.audience_spec_id is distinct from old.audience_spec_id then
    raise exception 'audience of published content cannot be changed; create new content instead' using errcode = '42501';
  end if;
  if tg_table_name = 'events' and new.audience is distinct from old.audience then
    raise exception 'audience of published content cannot be changed; create new content instead' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.snapshot_announcement_audience() from public, anon, authenticated;
revoke all on function public.snapshot_affirmation_audience()  from public, anon, authenticated;
revoke all on function public.snapshot_event_audience()        from public, anon, authenticated;

drop trigger if exists announcements_snapshot_audience on public.announcements;
create trigger announcements_snapshot_audience
  after insert on public.announcements
  for each row when (new.audience_spec_id is not null)
  execute function public.snapshot_announcement_audience();

drop trigger if exists confessions_snapshot_audience on public.confessions;
create trigger confessions_snapshot_audience
  after insert on public.confessions
  for each row when (new.audience_spec_id is not null)
  execute function public.snapshot_affirmation_audience();

drop trigger if exists events_snapshot_audience on public.events;
create trigger events_snapshot_audience
  after insert on public.events
  for each row when (new.audience_spec_id is not null)
  execute function public.snapshot_event_audience();

drop trigger if exists announcements_block_audience_change on public.announcements;
create trigger announcements_block_audience_change
  before update on public.announcements
  for each row execute function public.block_targeted_audience_change();

drop trigger if exists confessions_block_audience_change on public.confessions;
create trigger confessions_block_audience_change
  before update on public.confessions
  for each row execute function public.block_targeted_audience_change();

drop trigger if exists events_block_audience_change on public.events;
create trigger events_block_audience_change
  before update on public.events
  for each row execute function public.block_targeted_audience_change();

-- ─── 5. Visibility (RLS) reads the snapshot ──────────────────────────────────

-- Announcements: broadcast (spec NULL) to active members; targeted only to snapshot recipients, staff, and the author.
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select
  using (
    is_active = true
    and public.is_active_member()
    and (
      audience_spec_id is null
      or public.is_admin_or_coordinator()
      or author_id = auth.uid()
      or public.is_audience_recipient('announcement', id)
    )
  );

-- Cell leaders manage only their own announcements, and only with a single-cell spec for a cell they lead.
-- Broadcast (spec NULL) is staff-only. The 064 path that let leaders post broadcasts is removed.
drop policy if exists announcements_manage on public.announcements;
create policy announcements_manage on public.announcements
  for all
  to authenticated
  using (
    public.is_admin_or_coordinator()
    or (
      public.is_active_member()
      and author_id = auth.uid()
      and audience_spec_id is not null
      and public.audience_caller_can_target(audience_spec_id)
    )
  )
  with check (
    public.is_admin_or_coordinator()
    or (
      public.is_active_member()
      and author_id = auth.uid()
      and audience_spec_id is not null
      and public.audience_caller_can_target(audience_spec_id)
    )
  );

-- Affirmations: broadcast (spec NULL) to active members; targeted only to snapshot recipients and staff.
drop policy if exists confessions_read on public.confessions;
create policy confessions_read on public.confessions
  for select
  using (
    is_active = true
    and public.is_active_member()
    and (
      audience_spec_id is null
      or public.is_admin_or_coordinator()
      or public.is_audience_recipient('affirmation', id)
    )
  );

-- Events. Four ways in, and nothing else:
--   * audience 'all' with no spec: an open broadcast. Unchanged from 017 and 067, so accounts still pending approval
--     can read it (the approval screen depends on it);
--   * admins and coordinators, always;
--   * audience 'meeting' (no spec): the managers and participants of the linked meeting (067's gate, kept here);
--   * a targeted event (spec set): only its frozen snapshot recipients. Replaces 067's live resolve_audience() read,
--     so a person who joins a cell or group later does not gain access to earlier events.
-- Active accounts only, except the open broadcast above. Writes are unchanged (events_manage, 035).
drop policy if exists events_read on public.events;
create policy events_read on public.events
  for select
  using (
    (audience = 'all' and audience_spec_id is null)
    or public.is_admin_or_coordinator()
    or (
      public.is_active_member()
      and (
        (
          audience_spec_id is null
          and audience = 'meeting'
          and audience_meeting_id is not null
          and (
            public.is_meeting_manager(audience_meeting_id)
            or public.is_meeting_participant(audience_meeting_id)
          )
        )
        or (audience_spec_id is not null and public.is_audience_recipient('event', id))
      )
    )
  );

-- Declaration guard (063): can the caller see this affirmation? Reads the snapshot.
create or replace function public.can_see_affirmation(p_confession_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.confessions c
    where c.id = p_confession_id
      and c.is_active = true
      and public.is_active_member()
      and (
        c.audience_spec_id is null
        or public.is_admin_or_coordinator()
        or public.is_audience_recipient('affirmation', c.id)
      )
  )
$$;

-- ─── 6. Create spec: the only client write path ──────────────────────────────

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

-- ─── 7. Dispatch support: the snapshot recipients of a targeted item (service role only) ─

create or replace function public.audience_content_recipients(p_content_type text, p_content_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.profile_id
  from public.audience_publications p
  join public.audience_snapshots s on s.publication_id = p.id
  join public.profiles pr on pr.id = s.profile_id and pr.status = 'active'
  where p.content_type = p_content_type
    and p.content_id = p_content_id
  order by s.profile_id;
$$;

-- ─── 8. Privileges ───────────────────────────────────────────────────────────

revoke all on function public.audience_caller_can_target(uuid)                      from public, anon;
revoke all on function public.is_audience_recipient(text, uuid)                     from public, anon;
revoke all on function public.create_audience_spec(text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]) from public, anon;
revoke all on function public.audience_content_recipients(text, uuid)               from public, anon, authenticated;

grant execute on function public.audience_caller_can_target(uuid)                   to authenticated, service_role;
grant execute on function public.is_audience_recipient(text, uuid)                  to authenticated, service_role;
grant execute on function public.create_audience_spec(text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]) to authenticated;
grant execute on function public.audience_content_recipients(text, uuid)            to service_role;
grant execute on function public.can_see_affirmation(uuid)                          to authenticated, service_role;

-- Specs are read-only to clients. Staff keep the 059 read policy for review.
grant select on public.audience_specs to authenticated;
