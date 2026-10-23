-- 044_bsc_access_hardening.sql
--
-- Closes authorization gaps in the Bible Study Class (BSC) objects from migrations 040 and 042. This is an
-- additive migration. Historical migrations are not edited.
--
-- Intended rules, from migrations 022, 040 and 042:
--   * Only an active, approved account may read or write protected data (migration 022).
--   * Any active member may read the BSC list, which is needed to show BSC names (040).
--   * Coordinators and admins, and the active leader of a cell, may manage the BSCs of that cell (040).
--   * An active BSC leader sees full outreach contacts logged by members of that BSC. An active BSC peer sees
--     those contacts with phone and notes masked (042).
--   * Only staff (an active coordinator or admin) may change a member's BSC, as they may change cell_id (028).
--
-- Gaps closed here:
--   1. bscs_read let any signed-in account read every BSC row, including pending, rejected and inactive accounts.
--   2. bscs_manage checked the role only, so an inactive or rejected coordinator or cell leader kept write access.
--   3. is_bsc_leader_for_logger and is_bsc_peer_of_logger did not require an active account, so a rejected or
--      inactive BSC leader or peer kept contact visibility.
--   4. contacts_read let an inactive account read its own logged contacts.
--   5. profiles_self_onboarding_update (028) lets a pending account edit its own profile, and the 028 guard does not
--      protect bsc_id. A pending account could therefore assign itself to a BSC and gain BSC peer visibility.
--   6. The two BSC helper functions were executable by PUBLIC and anon, which is the default for new functions.
--   7. The helpers ran as the caller. profiles RLS shows a member only their own row, plus rows for coordinators and
--      their own cell, so the helper could not see the logger's bsc_id. The BSC leader and peer rules therefore never
--      matched other members. The helpers now run as SECURITY DEFINER with a pinned search_path (as
--      is_cell_leader_for_profile does in migration 022). They still key on auth.uid(), still require an active
--      caller, and return only a boolean.

-- ─── 1. Reads: active accounts only ────────────────────────────────────────────

drop policy if exists bscs_read on public.bscs;
create policy bscs_read on public.bscs
  for select to authenticated
  using (public.is_active_member());

-- ─── 2. Writes: active coordinators and admins, or the active leader of the cell ──

drop policy if exists bscs_manage on public.bscs;
create policy bscs_manage on public.bscs
  for all to authenticated
  using (public.is_core_admin() or public.is_cell_leader_of(bscs.cell_id))
  with check (public.is_core_admin() or public.is_cell_leader_of(bscs.cell_id));

-- ─── 3. Helpers: require an active account, keep security invoker and the pinned search_path ──

create or replace function public.is_bsc_leader_for_logger(p_logged_by uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and exists (
    select 1
    from public.profiles logger
    join public.bscs b on b.id = logger.bsc_id
    where logger.id = p_logged_by
      and b.leader_id = auth.uid()
  );
$$;

create or replace function public.is_bsc_peer_of_logger(p_logged_by uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and exists (
    select 1
    from public.profiles viewer
    join public.profiles logger on logger.bsc_id = viewer.bsc_id
    where viewer.id    = auth.uid()
      and logger.id    = p_logged_by
      and viewer.bsc_id is not null
      and viewer.id   <> p_logged_by
      and not exists (
        select 1 from public.bscs b
        where b.id = viewer.bsc_id and b.leader_id = auth.uid()
      )
  );
$$;

-- ─── 4. contacts_read: an inactive account gets no access, including to its own rows ──

drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts
  for select using (
    public.is_core_admin()
    or public.is_cell_leader_of(cell_id)
    or (logged_by = auth.uid() and public.is_active_member())
    or public.is_bsc_leader_for_logger(logged_by)
    or public.is_bsc_peer_of_logger(logged_by)
  );

-- ─── 5. profiles.bsc_id: only an active coordinator or admin may change it ──────

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
  if new.bsc_id is distinct from old.bsc_id and not public.is_core_admin() then
    raise exception 'Not authorised to change BSC membership.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_bsc_assignment on public.profiles;
create trigger profiles_guard_bsc_assignment
  before update on public.profiles
  for each row execute function public.guard_profile_bsc_assignment();

-- ─── 6. Helper privileges: authenticated only, as for is_core_admin() ──────────

revoke all on function public.is_bsc_leader_for_logger(uuid) from public, anon;
grant execute on function public.is_bsc_leader_for_logger(uuid) to authenticated;

revoke all on function public.is_bsc_peer_of_logger(uuid) from public, anon;
grant execute on function public.is_bsc_peer_of_logger(uuid) to authenticated;

revoke all on function public.guard_profile_bsc_assignment() from public, anon, authenticated;

-- ─── 7. service_role: the same table matrix as every other public table ─────────
-- Migration 040 gave service_role SELECT only. The reviewed contract expects DELETE, INSERT, SELECT and UPDATE for
-- service_role on every ordinary table (service_role is the trusted backend and already bypasses RLS on all of them).
-- The matrix is aligned here rather than exempting bscs. Flagged in the PR for review.
grant select, insert, update, delete on public.bscs to service_role;
