-- 070: cell-leader and member disclosure closure (from the privacy review of migrations 000-069).
-- Leaders read only the active members of cells they lead, through v_cell_member_directory, keyed by member_key.
-- Other profile rows, people and memberships are readable by staff or the person's own account only.
-- Members read shared prayers through v_prayer_requests_visible, which never exposes an anonymous author.
-- Forward-only. Staff and self-edit paths are unchanged.

-- 1. Opaque roster key: a leader-facing identifier that is neither the auth user id nor a people id.
create or replace function public.member_roster_key(p_user_id uuid)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to('roster-v1:' || p_user_id::text, 'UTF8')), 'hex')
$$;

-- 2. Profiles: a leader no longer reads other members' rows. Self and staff only.
drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin_or_coordinator());

-- 3. user_profiles: same boundary (bio, phone, first/last name, student_number).
drop policy if exists user_profiles_select_scoped on public.user_profiles;
create policy user_profiles_select_scoped on public.user_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin_or_coordinator());

-- 4. member_directory: staff and self only. Leaders use v_cell_member_directory (below).
create or replace view public.member_directory
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
where p.id = auth.uid() or public.is_admin_or_coordinator();

grant select on public.member_directory to authenticated;

-- 5. Leader channel for contact and biography. Replaces v_cell_member_contacts (068), which returned the auth user id
--    as member_id. Owner-run, so the explicit filter is the authority: active caller who leads the cell, active member.
--    Columns: approved contact (email, phone), ordinary biography, name, avatar, cell. No role, admin_role, status,
--    student_number, person_id, bsc_id or auth user id.
drop view if exists public.v_cell_member_contacts;
create view public.v_cell_member_directory
with (security_barrier = true)
as
select
  public.member_roster_key(p.id) as member_key,
  p.full_name,
  p.cell_id,
  p.email,
  up.phone,
  up.bio,
  p.avatar_url
from public.profiles p
left join public.user_profiles up on up.user_id = p.id
where p.status = 'active'
  and public.is_cell_leader_of(p.cell_id);

revoke all on public.v_cell_member_directory from public, anon;
grant select on public.v_cell_member_directory to authenticated;

-- 6. Leader detail for one roster member (replaces direct profiles/user_profiles reads by leaders in PersonDetailPanel).
--    SECURITY INVOKER: it reads only through the view, so it adds no authority.
create or replace function public.get_cell_member_profile(p_member_key text)
returns table (member_key text, full_name text, cell_id uuid, email text, phone text, bio text, avatar_url text)
language sql
stable
set search_path = public, pg_temp
as $$
  select v.member_key, v.full_name, v.cell_id, v.email, v.phone, v.bio, v.avatar_url
  from public.v_cell_member_directory v
  where v.member_key = p_member_key
$$;

revoke all on function public.get_cell_member_profile(text) from public, anon;
grant execute on function public.get_cell_member_profile(text) to authenticated;

-- 7. Identity and membership data: staff and the person's own linked account only. Previously any active member
--    could read every people row (email, phone) and every organisational membership (migrations 045).
drop policy if exists people_read on public.people;
create policy people_read on public.people
  for select to authenticated
  using (
    public.is_admin_or_coordinator()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.person_id = people.id)
  );

drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select to authenticated
  using (
    public.is_admin_or_coordinator()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.person_id = memberships.person_id)
  );

create or replace view public.organizational_member_directory
with (security_invoker = true)
as
select
  pe.id as person_id,
  m.id as membership_id,
  pe.full_name,
  pe.email,
  pe.phone,
  m.joined_at,
  m.role as membership_role,
  m.status as membership_status,
  m.cell_id,
  p.id as account_id,
  p.status as account_approval_status,
  p.role as account_role,
  p.avatar_url
from public.memberships m
join public.people pe on pe.id = m.person_id
left join public.profiles p on p.person_id = pe.id
where m.status = 'active'
  and public.is_admin_or_coordinator();

revoke all on table public.organizational_member_directory from public, anon;
grant select on table public.organizational_member_directory to authenticated, service_role;

-- 8. Prayer requests. A member reads other members' shared prayers only through this view, which never returns the
--    author of an anonymous request. Leaders read leadership requests from active authors of their cell, non-anonymous
--    only, through this view, which omits author_id. Staff keep table access through prayers_leadership_staff (067),
--    and authors keep prayers_own. Removes prayers_shared_read (010, rewritten by 022) and prayers_leadership_cell (067).
drop policy if exists prayers_shared_read on public.prayer_requests;
drop policy if exists prayers_leadership_cell on public.prayer_requests;

create or replace view public.v_prayer_requests_visible
with (security_barrier = true)
as
select
  p.id,
  p.content,
  p.visibility,
  p.is_active,
  p.is_anonymous,
  p.created_at,
  p.updated_at,
  p.answered_at,
  case when p.is_anonymous then null else p.author_name end as author_name
from public.prayer_requests p
where p.is_active
  and (
    (p.visibility = 'shared' and public.is_active_member())
    or (
      p.visibility = 'leadership'
      and not p.is_anonymous
      and public.is_cell_leader_of_user(p.author_id)
      and exists (select 1 from public.profiles a where a.id = p.author_id and a.status = 'active')
    )
  );

revoke all on public.v_prayer_requests_visible from public, anon;
grant select on public.v_prayer_requests_visible to authenticated;

-- 9. Cell ROR progress: key the rows by roster key, not auth user id, and state the active-member filter explicitly.
drop function if exists public.get_cell_ror_progress(text, text);
create function public.get_cell_ror_progress(
  p_today      text,
  p_month_year text
)
returns table(
  member_key        text,
  member_id         uuid,
  full_name         text,
  cell_id           uuid,
  cell_name         text,
  current_streak    int,
  longest_streak    int,
  monthly_completed int,
  monthly_total     int,
  last_completed    date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.member_roster_key(m.id),
    -- The auth user id is returned to staff only, for the existing per-member streak detail. Leaders receive null.
    case when public.is_admin_or_coordinator() then m.id else null end,
    m.full_name,
    c.id,
    c.name,
    (s.current_streak)::int,
    (s.longest_streak)::int,
    (s.monthly_completed)::int,
    (s.monthly_total)::int,
    s.last_completed
  from   public.cells c
  join   public.profiles m on m.cell_id = c.id and m.status = 'active'
  cross  join lateral public.get_ror_streak(m.id, p_today, p_month_year) s
  where  c.leader_id = auth.uid()
    and  public.is_active_member()
  order  by m.full_name;
$$;

revoke all on function public.get_cell_ror_progress(text, text) from public, anon;
grant execute on function public.get_cell_ror_progress(text, text) to authenticated;

-- The roster key is called by v_cell_member_directory, and a view checks EXECUTE for the querying role. Signed-in users
-- may execute it; PUBLIC and anonymous callers may not.
revoke all on function public.member_roster_key(uuid) from public, anon;
grant execute on function public.member_roster_key(uuid) to authenticated;
