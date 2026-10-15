-- 026_meeting_attendance_scoped_access.sql
--
-- Adds the minimum client-side access needed by the existing meeting
-- attendance UI. Dashboard and meeting list reads must not embed all
-- attendance rows just to calculate counts.

grant select, insert, update, delete on table public.meeting_attendances to authenticated;

drop policy if exists meeting_attendances_select_scoped on public.meeting_attendances;
drop policy if exists meeting_attendances_insert_own_visible on public.meeting_attendances;
drop policy if exists meeting_attendances_delete_own_or_manager on public.meeting_attendances;
drop policy if exists meeting_attendances_update_manager on public.meeting_attendances;

create policy meeting_attendances_select_scoped
  on public.meeting_attendances
  for select
  to authenticated
  using (
    public.is_active_member()
    and (
      user_id = auth.uid()
      or public.has_admin_permission('attendance.view_all')
      or exists (
        select 1
        from public.meetings m
        where m.id = meeting_attendances.meeting_id
          and (
            m.created_by = auth.uid()
            or public.is_cell_leader_of(m.cell_id)
          )
      )
    )
  );

create policy meeting_attendances_insert_own_visible
  on public.meeting_attendances
  for insert
  to authenticated
  with check (
    public.is_active_member()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.meetings m
      where m.id = meeting_attendances.meeting_id
    )
  );

create policy meeting_attendances_delete_own_or_manager
  on public.meeting_attendances
  for delete
  to authenticated
  using (
    public.is_active_member()
    and (
      user_id = auth.uid()
      or public.has_admin_permission('attendance.view_all')
      or exists (
        select 1
        from public.meetings m
        where m.id = meeting_attendances.meeting_id
          and (
            m.created_by = auth.uid()
            or public.is_cell_leader_of(m.cell_id)
          )
      )
    )
  );

create policy meeting_attendances_update_manager
  on public.meeting_attendances
  for update
  to authenticated
  using (
    public.is_active_member()
    and (
      public.has_admin_permission('attendance.view_all')
      or exists (
        select 1
        from public.meetings m
        where m.id = meeting_attendances.meeting_id
          and (
            m.created_by = auth.uid()
            or public.is_cell_leader_of(m.cell_id)
          )
      )
    )
  )
  with check (
    public.is_active_member()
    and (
      public.has_admin_permission('attendance.view_all')
      or exists (
        select 1
        from public.meetings m
        where m.id = meeting_attendances.meeting_id
          and (
            m.created_by = auth.uid()
            or public.is_cell_leader_of(m.cell_id)
          )
      )
    )
  );
