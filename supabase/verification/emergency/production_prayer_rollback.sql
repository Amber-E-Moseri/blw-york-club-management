-- ROLLBACK to the catalog text of the Production policy (exact USING expression from the supplied export).
begin;
drop policy if exists prayers_leadership_staff on public.prayer_requests;
create policy prayers_leadership_read on public.prayer_requests for select to public
  using ((visibility = any (array['leadership'::text, 'shared'::text])) and (exists (select 1 from public.profiles where ((profiles.id = auth.uid()) and (profiles.role = any (array['coordinator'::text, 'admin'::text, 'cell_leader'::text]))))));
commit;
