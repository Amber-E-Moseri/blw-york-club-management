-- 091_bsc_pending_visibility_policy.sql
--
-- Forward-only. PROPOSED, NOT APPLIED: diff review and approval first.
--
-- Approved policy for pending onboarding members:
--   * Admins and coordinators see pending members (profiles, member_directory, bsc_members_visible).
--   * A cell leader sees pending applicants assigned to their own cell, and only that cell, through
--     cell_leader_pending_roster(). The roster is restricted: applicant id, full name and cell id. No email, student
--     number, BSC, role or status detail. A leader gets no pending row from profiles, member_directory or the BSC roster.
--   * BSC-only leaders see no pending members.
--   * Ordinary members see no other pending member.
--   * A pending member sees their own onboarding row (profiles_select_scoped, id = auth.uid()).
--
-- Why profiles RLS changes: profiles_select_scoped (022) lets a cell leader read the full profiles row of every member
-- in their cell. For a pending applicant that row carries email and student_number. The cell-leader branch now excludes
-- pending rows, so the table no longer exposes them to leaders. Active, inactive and rejected rows keep their existing
-- cell-leader visibility unchanged, because removing it is a separate privacy decision (not made here).
--
-- Why bsc_members_visible changes: 091 as first proposed let a cell leader see pending members there, which returned
-- their email. The pending branch is restored to admins and coordinators (the 088 rule). Cell leaders reach pending
-- applicants only through the restricted roster below.
--
-- Unchanged: active-member visibility in bsc_members_visible, the same-cell join, the caller gate (is_active_member),
-- the self exclusion, and the three caller branches (admin or coordinator, BSC leader of the BSC, cell leader of the cell).
--
-- Dependencies: 022 (profiles_select_scoped, is_cell_leader_for_profile), 054 (is_cell_leader_of), 055 (is_bsc_leader_of),
-- 058 (membership gate), 088 (the bsc_members_visible pending rule this keeps), 016 (member_directory, security_invoker).

-- ─── 1. Table: a cell leader no longer reads a pending applicant's full profile row ──────────────────────────────────────

drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles
  for select
  using (
    id = auth.uid()
    or public.is_admin_or_coordinator()
    or (public.is_cell_leader_for_profile(id) and profiles.status is distinct from 'pending')
  );

-- member_directory is security_invoker, so it inherits the row rule above: a cell leader no longer lists a pending
-- applicant there. The view definition itself is unchanged (016).

-- ─── 2. Restricted roster for a cell leader: pending applicants in the leader's own cell ─────────────────────────────────

create or replace function public.cell_leader_pending_roster()
returns table (id uuid, full_name text, cell_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select p.id, p.full_name, p.cell_id
  from public.profiles p
  join public.cells c on c.id = p.cell_id
  where p.status = 'pending'
    and p.id <> auth.uid()
    and public.is_cell_leader_of(c.id)
  order by c.name, p.full_name
$function$;

revoke all on function public.cell_leader_pending_roster() from public, anon;
grant execute on function public.cell_leader_pending_roster() to authenticated;

-- ─── 3. BSC roster: pending members are for admins and coordinators only ─────────────────────────────────────────────────

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
  where (
      p.status = 'active'
      or (p.status = 'pending' and public.is_admin_or_coordinator())
    )
    and p.id <> auth.uid()
    and p.cell_id is not distinct from b.cell_id
    and public.is_active_member()
    and (
      public.is_admin_or_coordinator()
      or public.is_bsc_leader_of(b.id)
      or public.is_cell_leader_of(b.cell_id)
    )
  order by b.name, p.full_name
$function$;
