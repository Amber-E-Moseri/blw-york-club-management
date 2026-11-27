-- EMERGENCY MITIGATION v2 (NOT EXECUTED). Role-based prayer read replaced by an assignment rule.
-- Staff: unchanged. Assigned cell leaders: non-anonymous requests only (an anonymous author is never exposed to a leader),
-- leadership requests only from members of cells they lead, shared requests from any active assigned leader.
-- Role-only accounts with no assignment: nothing.
drop policy if exists prayers_leadership_read on public.prayer_requests;
create policy prayers_leadership_read on public.prayer_requests for select to public
  using (
    public.is_admin_or_coordinator()
    or (
      not is_anonymous
      and visibility in ('leadership', 'shared')
      and exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'active')
      and exists (select 1 from public.cells c where c.leader_id = auth.uid())
      and (
        visibility = 'shared'
        or exists (
          select 1 from public.profiles a
          join public.cells c2 on c2.id = a.cell_id
          where a.id = prayer_requests.author_id and a.status = 'active' and c2.leader_id = auth.uid()
        )
      )
    )
  );
