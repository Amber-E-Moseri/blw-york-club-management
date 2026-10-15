-- 031_announcements_active_guard.sql
--
-- F-1 fix: the announcements_manage policy created in migration 017 contained a
-- cell-leader branch:
--
--   OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'cell_leader')
--
-- ...which had no status check.  A rejected (or inactive) account whose role column
-- still reads 'cell_leader' could INSERT, UPDATE, and DELETE announcements.
--
-- Migration 022's dynamic rewriter only replaced `auth.role() = 'authenticated'`
-- patterns; this branch was never patched.
--
-- Fix: add AND status = 'active' to the EXISTS predicate so the branch mirrors
-- the status-gated helpers used elsewhere in the policy set.

drop policy if exists announcements_manage on public.announcements;

create policy announcements_manage on public.announcements
  for all
  using (
    public.is_admin_or_coordinator()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role = 'cell_leader'
        and status = 'active'
    )
  )
  with check (
    public.is_admin_or_coordinator()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role = 'cell_leader'
        and status = 'active'
    )
  );
