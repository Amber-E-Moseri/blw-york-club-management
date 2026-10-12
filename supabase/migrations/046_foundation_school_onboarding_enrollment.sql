-- 046_foundation_school_onboarding_enrollment.sql
--
-- Forward-only exception to migration 045 (decision T6). Authorised staff (admin or coordinator, active) may enrol a
-- PENDING student for onboarding. A pending student still cannot read or write protected course content or progress.
--
-- Before: enrollments_coordinator (ALL) required the student to be active for every operation, so a pending student
-- could not be enrolled at all.
--
-- After, on foundation_school_enrollments:
--   staff read    : staff, for students who are pending or active (onboarding). Rejected and inactive students excluded.
--   staff insert  : staff, for students who are pending or active.
--   staff update  : staff, only for ACTIVE students. A pending enrolment is not changed or removed by staff.
--   staff delete  : staff, only for ACTIVE students.
--
-- Unchanged, and deliberately narrow:
--   enrollments_own (student)         requires an active account (F5). A pending student does not see its own enrolment.
--   enrollments_teacher_read          requires an active teacher and an active student.
--   foundation_school_classes         course content: classes_read requires an active member (045 and before).
--   foundation_school_progress        all policies require an active student (progress is protected growth activity).
--
-- Scope: any active admin or coordinator may enrol. Foundation School has no per-group scoping in the schema, so this
-- migration does not introduce one. Cell leaders, teachers, members and inactive or pending staff are excluded.

drop policy if exists enrollments_coordinator on public.foundation_school_enrollments;

create policy enrollments_staff_read on public.foundation_school_enrollments for select
  using (
    public.is_admin_or_coordinator()
    and exists (
      select 1 from public.profiles s
      where s.id = foundation_school_enrollments.student_id and s.status in ('pending', 'active')
    )
  );

create policy enrollments_staff_insert on public.foundation_school_enrollments for insert
  with check (
    public.is_admin_or_coordinator()
    and exists (
      select 1 from public.profiles s
      where s.id = foundation_school_enrollments.student_id and s.status in ('pending', 'active')
    )
  );

create policy enrollments_staff_update on public.foundation_school_enrollments for update
  using (public.is_admin_or_coordinator() and public.is_active_profile(foundation_school_enrollments.student_id))
  with check (public.is_admin_or_coordinator() and public.is_active_profile(foundation_school_enrollments.student_id));

create policy enrollments_staff_delete on public.foundation_school_enrollments for delete
  using (public.is_admin_or_coordinator() and public.is_active_profile(foundation_school_enrollments.student_id));
