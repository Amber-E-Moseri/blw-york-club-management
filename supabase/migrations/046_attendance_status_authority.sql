-- 046_attendance_status_authority.sql
--
-- Minimal port of the attendance-state portion of integration migration 074.
-- It deliberately does not import that lineage's audience/publication machinery.
-- attendance_status is authoritative; attended remains a derived compatibility field.

alter table public.meetings
  add column if not exists published_at timestamptz default now();

alter table public.meeting_attendances
  add column if not exists attendance_status text;

alter table public.meeting_attendances
  drop constraint if exists meeting_attendances_status_check;
alter table public.meeting_attendances
  add constraint meeting_attendances_status_check
    check (attendance_status in ('invited', 'confirmed', 'attended', 'absent', 'excused'));

-- Existing false is ambiguous: it may mean "not yet recorded". Only true is evidence of
-- attendance; all other historical rows remain confirmations, never inferred absences.
update public.meeting_attendances
set attendance_status = case when attended is true then 'attended' else 'confirmed' end
where attendance_status is null;

alter table public.meeting_attendances
  alter column attendance_status set default 'invited',
  alter column attendance_status set not null;

create or replace function public.meeting_attendance_normalise()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Legacy writers that only know attended remain safe. false means "not verified",
  -- not a confirmed absence; new writers use attendance_status for an absent outcome.
  if tg_op = 'INSERT' and new.attended is not null and new.attendance_status = 'invited' then
    new.attendance_status := case when new.attended then 'attended' else 'confirmed' end;
  elsif tg_op = 'UPDATE'
    and new.attendance_status is not distinct from old.attendance_status
    and new.attended is distinct from old.attended then
    new.attendance_status := case when new.attended is true then 'attended' else 'confirmed' end;
  end if;

  -- An authenticated caller may confirm or excuse themselves, but may never certify
  -- their own attended/absent outcome. Organizers record outcomes for other people.
  if auth.uid() is not null
    and new.user_id = auth.uid()
    and new.attendance_status in ('attended', 'absent') then
    raise exception 'Members cannot record their own verified attendance.' using errcode = '42501';
  end if;

  new.attended := case new.attendance_status
    when 'attended' then true
    when 'absent' then false
    else null
  end;
  return new;
end;
$$;

revoke all on function public.meeting_attendance_normalise() from public, anon, authenticated;

drop trigger if exists meeting_attendances_normalise on public.meeting_attendances;
create trigger meeting_attendances_normalise
  before insert or update on public.meeting_attendances
  for each row execute function public.meeting_attendance_normalise();

-- Self-service writes can only express a response. Verified outcomes are manager-only,
-- always for another person.
drop policy if exists meeting_attendances_insert_own_visible on public.meeting_attendances;
create policy meeting_attendances_insert_own_visible
  on public.meeting_attendances
  for insert to authenticated
  with check (
    public.is_active_member()
    and exists (select 1 from public.meetings m where m.id = meeting_attendances.meeting_id)
    and (
      (user_id = auth.uid() and attendance_status in ('confirmed', 'excused') and attended is null)
      or (
        user_id <> auth.uid()
        and public.is_active_profile(user_id)
        and (
          public.is_admin_or_coordinator()
          or exists (
            select 1 from public.meetings m
            where m.id = meeting_attendances.meeting_id
              and (m.created_by = auth.uid() or public.is_cell_leader_of(m.cell_id))
          )
        )
      )
    )
  );

drop policy if exists meeting_attendances_update_manager on public.meeting_attendances;
create policy meeting_attendances_update_manager
  on public.meeting_attendances
  for update to authenticated
  using (
    public.is_active_member()
    and (
      public.has_admin_permission('attendance.view_all')
      or exists (
        select 1 from public.meetings m
        where m.id = meeting_attendances.meeting_id
          and (m.created_by = auth.uid() or public.is_cell_leader_of(m.cell_id))
      )
    )
  )
  with check (
    public.is_active_member()
    and user_id <> auth.uid()
    and (
      public.has_admin_permission('attendance.view_all')
      or exists (
        select 1 from public.meetings m
        where m.id = meeting_attendances.meeting_id
          and (m.created_by = auth.uid() or public.is_cell_leader_of(m.cell_id))
      )
    )
  );

create or replace function public.respond_to_meeting_invitation(p_meeting_id uuid, p_response text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_rows integer;
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Not authorised to respond to this meeting.' using errcode = '42501';
  end if;
  if p_response not in ('confirmed', 'excused') then
    raise exception 'Response must be confirmed or excused.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id
      and m.published_at is not null
      and (
        m.visibility = 'public'
        or (m.visibility = 'leaders' and public.current_user_role() in ('cell_leader', 'admin', 'coordinator'))
        or (m.visibility = 'cell' and exists (
          select 1 from public.profiles p where p.id = auth.uid() and p.cell_id = m.cell_id
        ))
        or exists (
          select 1 from public.meeting_attendances ma
          where ma.meeting_id = m.id and ma.user_id = auth.uid()
        )
      )
  ) then
    raise exception 'Meeting not found.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Member')
    into v_name from public.profiles where id = auth.uid();

  insert into public.meeting_attendances
    (meeting_id, user_id, user_name, attendance_status, confirmed_at)
  values (p_meeting_id, auth.uid(), v_name, p_response, now())
  on conflict (meeting_id, user_id) do update
    set attendance_status = excluded.attendance_status,
        confirmed_at = excluded.confirmed_at
    where public.meeting_attendances.attendance_status in ('invited', 'confirmed', 'excused');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Attendance has already been recorded by an organiser.' using errcode = '23514';
  end if;
  return p_response;
end;
$$;

revoke all on function public.respond_to_meeting_invitation(uuid, text) from public, anon;
grant execute on function public.respond_to_meeting_invitation(uuid, text) to authenticated, service_role;

