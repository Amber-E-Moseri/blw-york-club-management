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
