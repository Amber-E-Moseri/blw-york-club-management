-- 066_audience_resolution_scope.sql
--
-- Owner workstream: Shared audience infrastructure (forward-only correction)
-- Dependencies:    059 (resolve_audience, saved_groups, saved_group_members), 063 and 064 (RLS callers),
--                  065 (saved-group grants and read policies)
--
-- Problems corrected:
--   1. resolve_audience(uuid) is SECURITY DEFINER with no check on the caller and is executable by every
--      authenticated account. Any signed-in member who holds a spec id can list the full audience, including
--      people they cannot see. Spec ids are carried on rows members can read (announcements, affirmations and
--      messages), so the enumeration path is reachable and reveals protected membership.
--   2. saved_group_members_read (065) lets every active member read every saved-group membership.
--      That reveals who belongs to which group, which is protected membership.
--
-- Changes:
--   a. resolve_audience_all(uuid): the complete resolver with 059's semantics. Owner-only execute. Internal
--      definer functions call it (send_message and preview_audience in migration 067).
--   b. resolve_audience(uuid): admin and coordinator get the full list. Everyone else gets at most their own row,
--      so an RLS check of "ra.profile_id = auth.uid()" (063, 064) keeps exactly the same meaning and no caller
--      can enumerate another person's membership.
--   c. saved_groups and saved_group_members: readable only by admin and coordinator. Cell leaders and members
--      cannot read them. Writes stay as 065 defined them (staff only).

-- ── a. Complete resolver, owner-only ─────────────────────────────────────────

create or replace function public.resolve_audience_all(p_spec_id uuid)
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

revoke all on function public.resolve_audience_all(uuid) from public, anon, authenticated, service_role;

-- ── b. Caller-scoped resolver, same signature as 059 ─────────────────────────

create or replace function public.resolve_audience(p_spec_id uuid)
returns table(profile_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.profile_id
  from public.resolve_audience_all(p_spec_id) r
  where public.is_admin_or_coordinator()
     or r.profile_id = auth.uid();
$$;

revoke all on function public.resolve_audience(uuid) from public, anon;
grant execute on function public.resolve_audience(uuid) to authenticated, service_role;

-- ── c. Saved groups are staff-only to read ───────────────────────────────────

drop policy if exists saved_groups_read on public.saved_groups;
create policy saved_groups_read on public.saved_groups
  for select to authenticated
  using (public.is_admin_or_coordinator());

drop policy if exists saved_group_members_read on public.saved_group_members;
create policy saved_group_members_read on public.saved_group_members
  for select to authenticated
  using (public.is_admin_or_coordinator());

-- ── d. Deleting an audience spec must never widen visibility ──────────────────
-- 060, 063 and 064 declared audience_spec_id ... on delete set null. Deleting a spec would turn a targeted
-- event, affirmation or announcement into a broadcast ("spec is null means everyone"). A spec that a row still
-- depends on must not be deleted. Restrict the deletion instead.

alter table public.events        drop constraint if exists events_audience_spec_id_fkey;
alter table public.events        add constraint events_audience_spec_id_fkey
  foreign key (audience_spec_id) references public.audience_specs(id) on delete restrict;

alter table public.confessions   drop constraint if exists confessions_audience_spec_id_fkey;
alter table public.confessions   add constraint confessions_audience_spec_id_fkey
  foreign key (audience_spec_id) references public.audience_specs(id) on delete restrict;

alter table public.announcements drop constraint if exists announcements_audience_spec_id_fkey;
alter table public.announcements add constraint announcements_audience_spec_id_fkey
  foreign key (audience_spec_id) references public.audience_specs(id) on delete restrict;

-- Specs are immutable and never deleted by clients. Make that explicit at the grant level.
revoke update, delete on public.audience_specs from public, anon, authenticated;

-- ── e. Cell leaders cannot create or move an announcement to a broadcast ──────
-- 064's with_check allowed audience_spec_id IS NULL for a cell leader, which is a fellowship-wide broadcast.
-- A leader may write only a cells-mode spec naming exactly their own cell. Staff keep full rights.

drop policy if exists announcements_manage on public.announcements;
create policy announcements_manage on public.announcements
  for all
  to authenticated
  using (
    public.is_admin_or_coordinator()
    or (
      public.is_active_member()
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'cell_leader'
          and status = 'active'
      )
      and (
        author_id = auth.uid()
        or (
          audience_spec_id is not null
          and exists (
            select 1
            from public.audience_specs s
            where s.id = announcements.audience_spec_id
              and s.mode = 'cells'
              and exists (
                select 1 from public.cells c
                where c.id = any(s.cell_ids)
                  and c.leader_id = auth.uid()
              )
          )
        )
      )
    )
  )
  with check (
    public.is_admin_or_coordinator()
    or (
      public.is_active_member()
      and author_id = auth.uid()
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'cell_leader'
          and status = 'active'
      )
      -- Not null: a leader can never write a broadcast. The spec must be cells-mode and name exactly one cell,
      -- and that cell must be one the leader leads.
      and audience_spec_id is not null
      and exists (
        select 1
        from public.audience_specs s
        where s.id = audience_spec_id
          and s.mode = 'cells'
          and array_length(s.cell_ids, 1) = 1
          and exists (
            select 1 from public.cells c
            where c.id = s.cell_ids[1]
              and c.leader_id = auth.uid()
          )
      )
    )
  );
