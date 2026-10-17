-- Migration 039: ROR reading streaks — DB helpers and RLS extensions
--
-- No new tables required: devotional_views already records one row per member
-- per calendar date when the member explicitly marks a day as read. This
-- migration adds:
--   1. A function for the cell-leader membership check (is_member_in_my_cell).
--   2. Updated devotional_views RLS so cell leaders can read their own
--      members' completion rows (read-only).
--   3. A set-returning function get_ror_streak() for streak computation.
--   4. A set-returning function get_cell_ror_progress() for cell leaders.
--   5. A set-returning function get_org_ror_progress() for coordinators.
--
-- Timezone: all dates are stored in UTC. The client passes today's date as
-- a text parameter so the server never needs to localise. Adjust the client
-- to use the org's preferred timezone when calling these functions if
-- needed in future.

-- ─── Helper: is the target member in any cell I lead? ────────────────────────

create or replace function public.is_member_in_my_cell(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles leader
    join public.cells c on c.leader_id = leader.id
    join public.profiles member on member.cell_id = c.id
    where leader.id = auth.uid()
      and member.id = p_member_id
  );
$$;

-- ─── RLS: cell leaders may read completions for their own members ─────────────

drop policy if exists devotional_views_select_own_or_admin on public.devotional_views;
create policy devotional_views_select_own_or_admin
  on public.devotional_views for select
  using (
    auth.uid() = member_id
    or public.is_devotional_admin()
    or public.is_member_in_my_cell(member_id)
  );

-- ─── streak computation ───────────────────────────────────────────────────────
-- Returns current_streak, longest_streak, monthly_completed, monthly_total.
-- p_today      : the caller's local today as 'YYYY-MM-DD'  (text)
-- p_month_year : 'YYYY-MM' for the month whose completion% to report
--
-- Streak rule:
--   * A streak is a maximal run of consecutive calendar days on which the
--     member has at least one completion row.
--   * If the member has not yet completed today but completed yesterday the
--     current streak is still alive (spec: "should not reset simply because
--     today's devotional has not yet been completed").

create or replace function public.get_ror_streak(
  p_member_id  uuid,
  p_today      text,   -- 'YYYY-MM-DD'
  p_month_year text    -- 'YYYY-MM'
)
returns table(
  current_streak   int,
  longest_streak   int,
  monthly_completed int,
  monthly_total    int,
  last_completed   date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with distinct_dates as (
    select distinct viewed_date as d
    from   public.devotional_views
    where  member_id = p_member_id
  ),
  -- islands: each consecutive run of dates gets the same grp value
  grps as (
    select d,
           d - (row_number() over (order by d))::int * interval '1 day' as grp
    from   distinct_dates
  ),
  streaks as (
    select grp,
           count(*)::int  as len,
           min(d)         as first_date,
           max(d)         as last_date
    from   grps
    group  by grp
  ),
  -- current streak: the streak whose last date is today or yesterday
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
  -- monthly completion
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
    from   public.devotional_views dv
    join   public.monthly_devotionals md
           on md.id = dv.devotional_id
    where  dv.member_id = p_member_id
      and  to_char(make_date(md.year, md.month, 1), 'YYYY-MM') = p_month_year
  )
  select
    current_calc.val,
    longest_calc.val,
    month_completed.val,
    month_total.val,
    last_done.val
  from current_calc, longest_calc, month_completed, month_total, last_done;
$$;

-- ─── cell leader progress view ────────────────────────────────────────────────
-- Returns one row per member in the caller's cells, with streak data.

create or replace function public.get_cell_ror_progress(
  p_today      text,   -- 'YYYY-MM-DD'
  p_month_year text    -- 'YYYY-MM'
)
returns table(
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
    m.id,
    m.full_name,
    c.id,
    c.name,
    (s.current_streak)::int,
    (s.longest_streak)::int,
    (s.monthly_completed)::int,
    (s.monthly_total)::int,
    s.last_completed
  from   public.cells c
  join   public.profiles m on m.cell_id = c.id
  cross  join lateral public.get_ror_streak(m.id, p_today, p_month_year) s
  where  c.leader_id = auth.uid()
  order  by m.full_name;
$$;

-- ─── coordinator / org-wide progress ─────────────────────────────────────────

create or replace function public.get_org_ror_progress(
  p_today      text,
  p_month_year text
)
returns table(
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
    m.id,
    m.full_name,
    c.id,
    c.name,
    (s.current_streak)::int,
    (s.longest_streak)::int,
    (s.monthly_completed)::int,
    (s.monthly_total)::int,
    s.last_completed
  from   public.profiles m
  left   join public.cells c on c.id = m.cell_id
  cross  join lateral public.get_ror_streak(m.id, p_today, p_month_year) s
  where  m.role in ('member','cell_leader','admin','coordinator')
    and  public.is_devotional_admin()          -- coordinator or admin only
  order  by c.name nulls last, m.full_name;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- PostgreSQL grants EXECUTE to PUBLIC by default; revoke before re-granting to authenticated only.

revoke all on function public.is_member_in_my_cell(uuid)               from public, anon;
revoke all on function public.get_ror_streak(uuid, text, text)          from public, anon;
revoke all on function public.get_cell_ror_progress(text, text)         from public, anon;
revoke all on function public.get_org_ror_progress(text, text)          from public, anon;

grant execute on function public.get_ror_streak(uuid, text, text)          to authenticated;
grant execute on function public.get_cell_ror_progress(text, text)         to authenticated;
grant execute on function public.get_org_ror_progress(text, text)          to authenticated;
grant execute on function public.is_member_in_my_cell(uuid)                to authenticated;
