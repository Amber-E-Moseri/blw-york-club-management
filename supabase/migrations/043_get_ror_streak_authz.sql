-- 043_get_ror_streak_authz.sql
--
-- Security fix: add in-body authorization guard to get_ror_streak().
--
-- Root cause
--   get_ror_streak() is SECURITY DEFINER, so it runs as the DB owner and
--   bypasses the RLS policy on devotional_views. Any authenticated user
--   (including pending/inactive accounts) can call:
--     SELECT * FROM get_ror_streak('<victim_uuid>', '2026-10-18', '2026-10')
--   and receive the victim's full reading-streak data.
--
-- Fix: authorization gate CTE
--   An auth_gate CTE produces one row iff the caller is permitted to view
--   p_member_id's streak. The final SELECT adds a WHERE EXISTS (auth_gate)
--   clause that returns an empty result set for unauthorized callers.
--
-- Permitted callers
--   1. The member themselves — their profile must be active.
--   2. A devotional admin — is_devotional_admin() already enforces status='active'.
--   3. A cell leader of the member's cell — is_member_in_my_cell() is strengthened
--      below to require both the leader and the member to be active.
--
-- Secondary fix: is_member_in_my_cell active-status guard
--   The original function did not check status='active' on either the leader or
--   the member.  An inactive leader or an inactive member should not pass the
--   cell-leader authorization path.

-- ─── Step 1: Strengthen is_member_in_my_cell ─────────────────────────────────

create or replace function public.is_member_in_my_cell(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from   public.profiles leader
    join   public.cells    c      on c.leader_id  = leader.id
    join   public.profiles member on member.cell_id = c.id
    where  leader.id     = auth.uid()
      and  leader.status = 'active'
      and  member.id     = p_member_id
      and  member.status = 'active'
  );
$$;

-- ─── Step 2: Replace get_ror_streak with authorization guard ──────────────────

create or replace function public.get_ror_streak(
  p_member_id  uuid,
  p_today      text,   -- 'YYYY-MM-DD'
  p_month_year text    -- 'YYYY-MM'
)
returns table(
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
  with
  -- Authorization gate: zero rows → unauthorized; one or more rows → permitted.
  auth_gate as (
    -- Own data — caller's profile must be active.
    select 1 as ok
    where  p_member_id = auth.uid()
      and  exists (
             select 1 from public.profiles
             where id = auth.uid() and status = 'active'
           )
    union all
    -- Devotional admin (is_devotional_admin already requires status='active').
    select 1
    where  public.is_devotional_admin()
    union all
    -- Cell leader of this member (is_member_in_my_cell now requires both active).
    select 1
    where  public.is_member_in_my_cell(p_member_id)
  ),
  distinct_dates as (
    select distinct viewed_date as d
    from   public.devotional_views
    where  member_id = p_member_id
  ),
  grps as (
    select d,
           d - (row_number() over (order by d))::int * interval '1 day' as grp
    from   distinct_dates
  ),
  streaks as (
    select grp,
           count(*)::int as len,
           min(d)        as first_date,
           max(d)        as last_date
    from   grps
    group  by grp
  ),
  current_calc as (
    select coalesce(
      (select len
       from   streaks
       where  last_date >= p_today::date - interval '1 day'
         and  last_date <= p_today::date
       order  by last_date desc
       limit  1), 0) as val
  ),
  longest_calc as (
    select coalesce(max(len), 0) as val from streaks
  ),
  last_done as (
    select max(d) as val from distinct_dates
  ),
  month_total as (
    select coalesce((
      select total_days
      from   public.monthly_devotionals
      where  to_char(make_date(year, month, 1), 'YYYY-MM') = p_month_year
      order  by created_at desc
      limit  1
    ), 0) as val
  ),
  month_completed as (
    select count(distinct dv.day_of_month)::int as val
    from   public.devotional_views   dv
    join   public.monthly_devotionals md on md.id = dv.devotional_id
    where  dv.member_id = p_member_id
      and  to_char(make_date(md.year, md.month, 1), 'YYYY-MM') = p_month_year
  )
  select
    current_calc.val,
    longest_calc.val,
    month_completed.val,
    month_total.val,
    last_done.val
  from current_calc, longest_calc, month_completed, month_total, last_done
  -- Gate: return empty result set when auth_gate produced no rows.
  where exists (select 1 from auth_gate);
$$;

-- Grants are unchanged from migration 039 — re-assert to be explicit.
revoke all on function public.is_member_in_my_cell(uuid)      from public, anon;
revoke all on function public.get_ror_streak(uuid, text, text) from public, anon;
grant  execute on function public.is_member_in_my_cell(uuid)      to authenticated;
grant  execute on function public.get_ror_streak(uuid, text, text) to authenticated;
