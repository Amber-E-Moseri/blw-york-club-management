-- 045_authz_active_staff_and_confession_privacy.sql
--
-- Forward-only authorisation remediation. Changes policies and two functions; no table, column or data changes.
--
--   F1  Staff authority requires an active account. Inline `profiles.role` checks (no status test) are replaced with
--       the status-gated helpers is_coordinator(), is_admin_or_coordinator(), is_devotional_admin(),
--       is_active_member(). Each role keeps exactly the scope it had.
--   F2  Confession declarations: members no longer read other members' declaration rows. The application reads counts
--       through confession_declaration_counts(), which returns counts only.
--   F3  BSC and cell leader access to member records requires an active leader.
--   F4  Pending members: leaders and staff see pending members in their scope for onboarding (bsc_members_visible),
--       but never their devotional, confession or growth records.
--   F5  Pending self-access: profile self-read and self-onboarding update are unchanged. Protected devotional and
--       growth records of a pending account are unreadable and unwritable until the account is active.
--
-- Scope is never widened: no role gains a table it could not reach before, and no leader gains an unrelated member.

-- ─── F1: staff write and read policies, status-gated ─────────────────────────────────────────────────────────────

drop policy if exists admin_role_assignments_manage on public.admin_role_assignments;
create policy admin_role_assignments_manage on public.admin_role_assignments for all
  using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists admin_role_permissions_manage on public.admin_role_permissions;
create policy admin_role_permissions_manage on public.admin_role_permissions for all
  using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists admin_roles_manage on public.admin_roles;
create policy admin_roles_manage on public.admin_roles for all
  using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists books_manage on public.books_of_month;
create policy books_manage on public.books_of_month for all
  using (public.is_admin_or_coordinator()) with check (public.is_admin_or_coordinator());

drop policy if exists cells_manage on public.cells;
create policy cells_manage on public.cells for all
  using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists daily_pages_manage on public.devotional_daily_pages;
create policy daily_pages_manage on public.devotional_daily_pages for all
  using (public.is_devotional_admin()) with check (public.is_devotional_admin());

drop policy if exists devotional_manage on public.monthly_devotionals;
create policy devotional_manage on public.monthly_devotionals for all
  using (public.is_admin_or_coordinator()) with check (public.is_admin_or_coordinator());

drop policy if exists email_log_admin_manage on public.email_log;
create policy email_log_admin_manage on public.email_log for all
  using (public.is_admin_or_coordinator()) with check (public.is_admin_or_coordinator());

drop policy if exists email_log_admin_read on public.email_log;
create policy email_log_admin_read on public.email_log for select
  using (public.is_admin_or_coordinator());

drop policy if exists classes_manage on public.foundation_school_classes;
create policy classes_manage on public.foundation_school_classes for all
  using (public.is_admin_or_coordinator()) with check (public.is_admin_or_coordinator());

drop policy if exists people_delete on public.people;
create policy people_delete on public.people for delete
  using (public.is_coordinator());

drop policy if exists meetings_manage_scoped on public.meetings;
create policy meetings_manage_scoped on public.meetings for all
  using (
    public.is_admin_or_coordinator()
    or (public.current_user_role() = 'cell_leader' and (created_by = auth.uid() or public.is_cell_leader_of(cell_id)))
  )
  with check (
    public.is_admin_or_coordinator()
    or (public.current_user_role() = 'cell_leader' and created_by = auth.uid() and public.is_cell_leader_of(cell_id))
  );

drop policy if exists meetings_leaders_read on public.meetings;
create policy meetings_leaders_read on public.meetings for select
  using (visibility = 'leaders' and public.current_user_role() in ('cell_leader', 'admin', 'coordinator'));

drop policy if exists meetings_cell_read on public.meetings;
create policy meetings_cell_read on public.meetings for select
  using (
    visibility = 'cell'
    and public.is_active_member()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.cell_id = meetings.cell_id)
  );

drop policy if exists prayers_coordinator_manage on public.prayer_requests;
create policy prayers_coordinator_manage on public.prayer_requests for update
  using (public.is_admin_or_coordinator()) with check (public.is_admin_or_coordinator());

-- Leadership prayer reads: active staff, and only for authors who are active (F4).
drop policy if exists prayers_leadership_read on public.prayer_requests;
create policy prayers_leadership_read on public.prayer_requests for select
  using (
    visibility in ('leadership', 'shared')
    and public.current_user_role() in ('coordinator', 'admin', 'cell_leader')
    and public.is_active_profile(prayer_requests.author_id)
  );

drop policy if exists enrollments_coordinator on public.foundation_school_enrollments;
create policy enrollments_coordinator on public.foundation_school_enrollments for all
  using (
    public.is_admin_or_coordinator()
    and public.is_active_profile(foundation_school_enrollments.student_id)
  )
  with check (
    public.is_admin_or_coordinator()
    and public.is_active_profile(foundation_school_enrollments.student_id)
  );

drop policy if exists progress_coordinator on public.foundation_school_progress;
create policy progress_coordinator on public.foundation_school_progress for all
  using (
    public.is_admin_or_coordinator()
    and exists (
      select 1 from public.foundation_school_enrollments e
      where e.id = foundation_school_progress.enrollment_id
        and public.is_active_profile(e.student_id)
    )
  )
  with check (
    public.is_admin_or_coordinator()
    and exists (
      select 1 from public.foundation_school_enrollments e
      where e.id = foundation_school_progress.enrollment_id
        and public.is_active_profile(e.student_id)
    )
  );

-- ─── F3 + F4: member scope for leaders. The caller must be active; pending members are hidden from activity ──────

create or replace function public.can_view_member(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and exists (
    select 1
    from public.profiles m
    where m.id = p_member_id
      and m.status = 'active'
      and (
        m.id = auth.uid()
        or public.is_admin_or_coordinator()
        or exists (
          select 1 from public.bscs b
          where b.id = m.bsc_id
            and (b.leader_id = auth.uid() or public.is_cell_leader_of(b.cell_id))
        )
      )
  )
$$;

-- Onboarding list: pending and active members in the caller's BSC scope (F4). Profile fields only, no activity.
create or replace function public.bsc_members_visible()
returns table (id uuid, full_name text, email text, bsc_id uuid, bsc_name text, cell_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.email, p.bsc_id, b.name, b.cell_id
  from public.profiles p
  join public.bscs b on b.id = p.bsc_id
  where p.status in ('active', 'pending')
    and p.id <> auth.uid()
    and public.is_active_member()
    and (public.is_admin_or_coordinator() or b.leader_id = auth.uid() or public.is_cell_leader_of(b.cell_id))
  order by b.name, p.full_name
$$;

-- ─── F2: confession declarations ─────────────────────────────────────────────────────────────────────────────────

-- Removes the broad read (any active member saw every declaration row). Own rows and scoped reads remain through
-- confession_declarations_read_scoped, which is can_view_member(user_id).
drop policy if exists confession_declarations_read on public.confession_declarations;

create or replace function public.confession_declaration_counts(p_confession_ids uuid[])
returns table (confession_id uuid, declaration_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.confession_id, count(*)
  from public.confession_declarations d
  where d.confession_id = any(p_confession_ids)
    and public.is_active_member()
    and public.is_active_profile(d.user_id)  -- counts only active members, so a pending or rejected declaration is not inferable
  group by d.confession_id
$$;

revoke all on function public.confession_declaration_counts(uuid[]) from public, anon;
grant execute on function public.confession_declaration_counts(uuid[]) to authenticated;

-- ─── F4 + F5: devotional reads ───────────────────────────────────────────────────────────────────────────────────

-- Own or in-scope active member only (can_view_member now requires an active caller and an active member).
drop policy if exists devotional_views_select_own_or_admin on public.devotional_views;
create policy devotional_views_select_own_or_admin on public.devotional_views for select
  using (public.can_view_member(member_id));

-- Admin read of Rhapsody reads: staff only, and only for active members.
drop policy if exists views_admin_read on public.devotional_views;
create policy views_admin_read on public.devotional_views for select
  using (
    public.is_devotional_admin()
    and public.is_active_profile(devotional_views.member_id)
  );

-- F5: a pending account can neither read nor write its own Rhapsody records until it is active.
drop policy if exists views_own on public.devotional_views;
create policy views_own on public.devotional_views for all
  using (auth.uid() = member_id and public.is_active_member())
  with check (auth.uid() = member_id and public.is_active_member());

-- ─── F5: growth records (habits, Foundation School, prayers) ─────────────────────────────────────────────────────

drop policy if exists habit_entries_own on public.habit_entries;
create policy habit_entries_own on public.habit_entries for all
  using (auth.uid() = user_id and public.is_active_member())
  with check (auth.uid() = user_id and public.is_active_member());

drop policy if exists habit_entries_admin_read on public.habit_entries;
create policy habit_entries_admin_read on public.habit_entries for select
  using (
    (auth.uid() = user_id and public.is_active_member())
    or (
      public.is_admin_or_coordinator()
      and public.is_active_profile(habit_entries.user_id)
    )
  );

drop policy if exists enrollments_own on public.foundation_school_enrollments;
create policy enrollments_own on public.foundation_school_enrollments for select
  using (auth.uid() = student_id and public.is_active_member());

drop policy if exists enrollments_teacher_read on public.foundation_school_enrollments;
create policy enrollments_teacher_read on public.foundation_school_enrollments for select
  using (
    auth.uid() = teacher_id
    and public.is_active_member()
    and public.is_active_profile(foundation_school_enrollments.student_id)
  );

drop policy if exists progress_own on public.foundation_school_progress;
create policy progress_own on public.foundation_school_progress for select
  using (
    public.is_active_member()
    and exists (
      select 1 from public.foundation_school_enrollments e
      where e.id = foundation_school_progress.enrollment_id and e.student_id = auth.uid()
    )
  );

drop policy if exists progress_teacher_read on public.foundation_school_progress;
create policy progress_teacher_read on public.foundation_school_progress for select
  using (
    public.is_active_member()
    and exists (
      select 1
      from public.foundation_school_enrollments e
      where e.id = foundation_school_progress.enrollment_id
      and e.teacher_id = auth.uid()
      and public.is_active_profile(e.student_id)
    )
  );

drop policy if exists prayers_own on public.prayer_requests;
create policy prayers_own on public.prayer_requests for all
  using (auth.uid() = author_id and public.is_active_member())
  with check (auth.uid() = author_id and public.is_active_member());
