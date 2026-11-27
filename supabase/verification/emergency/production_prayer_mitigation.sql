-- PROPOSED emergency mitigation (NOT EXECUTED). Removes the role-based leadership read of prayer requests and gives staff the
-- same visibility rule. Cell leaders lose leadership-prayer reads until the reconciled candidate policy is applied.
begin;
drop policy if exists prayers_leadership_read on public.prayer_requests;
create policy prayers_leadership_staff on public.prayer_requests for select to public
  using ((visibility = any (array['leadership'::text, 'shared'::text])) and public.is_admin_or_coordinator());
commit;
