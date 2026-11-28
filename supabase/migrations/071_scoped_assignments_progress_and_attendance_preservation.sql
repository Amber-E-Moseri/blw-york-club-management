-- 071: scoped follow-up assignment, leader reading progress by member key, a dispatch lifecycle that records partial
-- delivery, and attendance preservation (the trigger no longer rewrites historical attended values).
-- Forward-only. No historical row is updated by this migration.

-- ─── A. Resolve a leader-facing member key to the internal user id, for an authorised caller only ───────────────────
-- Staff may resolve any active member. A cell leader may resolve active members of cells they lead. Anything else,
-- including a stale or unknown key, resolves to null. Clients never execute this function.
create or replace function public.resolve_cell_member_user(p_member_key text, p_actor uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_staff boolean;
begin
  select exists (
    select 1 from public.profiles a
    where a.id = p_actor and a.status = 'active' and a.role in ('admin', 'coordinator')
  ) into v_staff;

  select p.id into v_id
  from public.profiles p
  where p.status = 'active'
    and public.member_roster_key(p.id) = p_member_key
    and (
      v_staff
      or exists (select 1 from public.cells c where c.id = p.cell_id and c.leader_id = p_actor)
    )
  limit 1;
  return v_id;
end;
$$;

revoke all on function public.resolve_cell_member_user(text, uuid) from public, anon, authenticated;

-- ─── B. Assign a contact's follow-up to a member, by member key ──────────────────────────────────────────────────────
-- Authority: staff, or an active leader of the contact's cell. The assignee must be an active member of that same cell
-- (staff may assign any active member). A stale or ineligible key is refused with P0002 and nothing changes.
create or replace function public.assign_contact_follow_up(p_contact_id uuid, p_member_key text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_staff boolean;
  v_cell uuid;
  v_target uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.profiles a
    where a.id = v_actor and a.status = 'active' and a.role in ('admin', 'coordinator')
  ) into v_staff;

  select c.cell_id into v_cell from public.contacts c where c.id = p_contact_id and c.archived = false;
  if not found then
    raise exception 'contact not found' using errcode = '42501';
  end if;

  if not v_staff and not exists (select 1 from public.cells k where k.id = v_cell and k.leader_id = v_actor) then
    raise exception 'not authorised to assign this contact' using errcode = '42501';
  end if;

  v_target := public.resolve_cell_member_user(p_member_key, v_actor);
  if v_target is null then
    raise exception 'member is not eligible for assignment' using errcode = 'P0002';
  end if;

  if not v_staff and not exists (
    select 1 from public.profiles p where p.id = v_target and p.cell_id = v_cell and p.status = 'active'
  ) then
    raise exception 'member is not in this contact''s cell' using errcode = 'P0002';
  end if;

  update public.contacts set follow_up_assignee = v_target where id = p_contact_id;
  return p_member_key;
end;
$$;

revoke all on function public.assign_contact_follow_up(uuid, text) from public, anon;
grant execute on function public.assign_contact_follow_up(uuid, text) to authenticated;

-- ─── C. Database boundary for every other path that sets follow_up_assignee (insert or update) ───────────────────────
-- Non-staff writers may assign only to an active member of the contact's cell, or to themselves. Staff are unrestricted
-- by this trigger, as before. Refused writes raise 42501.
create or replace function public.contacts_guard_follow_up_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.follow_up_assignee is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.follow_up_assignee is not distinct from old.follow_up_assignee then
    return new;
  end if;
  if v_actor is null then
    return new;  -- service-role and migration writers; the functions above carry their own checks
  end if;
  if public.is_admin_or_coordinator() then
    return new;
  end if;
  if new.follow_up_assignee = v_actor then
    return new;
  end if;
  if new.cell_id is not null
    and exists (select 1 from public.cells k where k.id = new.cell_id and k.leader_id = v_actor)
    and exists (
      select 1 from public.profiles p
      where p.id = new.follow_up_assignee and p.cell_id = new.cell_id and p.status = 'active'
    )
  then
    return new;
  end if;
  raise exception 'follow-up may be assigned only to an active member of the contact''s cell' using errcode = '42501';
end;
$$;

revoke all on function public.contacts_guard_follow_up_assignee() from public, anon, authenticated;

drop trigger if exists contacts_guard_follow_up_assignee on public.contacts;
create trigger contacts_guard_follow_up_assignee
  before insert or update of follow_up_assignee on public.contacts
  for each row execute function public.contacts_guard_follow_up_assignee();

-- ─── D. Reading progress for one member under a leader's care: dates only, by member key ─────────────────────────────
-- Returns only the dates and day numbers read, for a member the caller may review (staff, or leader of the member's cell).
-- Unknown, stale or unauthorised keys return no rows, so the function does not reveal whether a member exists.
create or replace function public.get_cell_member_read_dates(p_member_key text, p_devotional_id uuid)
returns table (viewed_date date, day_of_month int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_target := public.resolve_cell_member_user(p_member_key, v_actor);
  if v_target is null then
    return;
  end if;
  return query
    select v.viewed_date, v.day_of_month
    from public.devotional_views v
    where v.member_id = v_target and v.devotional_id = p_devotional_id
    order by v.day_of_month;
end;
$$;

revoke all on function public.get_cell_member_read_dates(text, uuid) from public, anon;
grant execute on function public.get_cell_member_read_dates(text, uuid) to authenticated;

-- ─── E. Dispatch lifecycle: claimed -> sending -> completed | partial; release only before sending ──────────────────
alter table public.announcement_dispatches
  add column if not exists status text not null default 'claimed'
    check (status in ('claimed', 'sending', 'completed', 'partial')),
  add column if not exists sent_count int not null default 0 check (sent_count >= 0),
  add column if not exists failed_count int not null default 0 check (failed_count >= 0),
  add column if not exists sending_at timestamptz,
  add column if not exists finished_at timestamptz;

create or replace function public.begin_announcement_send(p_announcement_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.announcement_dispatches
  set status = 'sending', sending_at = now()
  where announcement_id = p_announcement_id and claimed_by = p_actor and status = 'claimed';
  return found;
end;
$$;

create or replace function public.complete_announcement_dispatch(
  p_announcement_id uuid,
  p_actor uuid,
  p_sent int,
  p_failed int
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  v_status := case when p_failed > 0 then 'partial' else 'completed' end;
  update public.announcement_dispatches
  set status = v_status, sent_count = p_sent, failed_count = p_failed, finished_at = now()
  where announcement_id = p_announcement_id and claimed_by = p_actor and status = 'sending';
  if not found then
    raise exception 'dispatch is not in a sending state for this actor' using errcode = '42501';
  end if;
  return v_status;
end;
$$;

-- Release is allowed only before any push: status must still be 'claimed'. A 'sending' claim is never released.
create or replace function public.release_announcement_dispatch(p_announcement_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.announcement_dispatches
  where announcement_id = p_announcement_id and claimed_by = p_actor and status = 'claimed';
end;
$$;

-- Recipients are resolved only while the dispatch is claimed or sending by this actor.
create or replace function public.resolve_announcement_recipients(p_announcement_id uuid, p_actor uuid)
returns table (user_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.announcement_dispatches d
    where d.announcement_id = p_announcement_id and d.claimed_by = p_actor and d.status in ('claimed', 'sending')
  ) then
    raise exception 'dispatch not claimed by this actor' using errcode = '42501';
  end if;

  return query
    select p.id, s.id, s.endpoint, s.p256dh, s.auth
    from public.announcements a
    join public.profiles p
      on p.status = 'active'
     and (a.cell_id is null or p.cell_id = a.cell_id)
    join public.push_subscriptions s
      on s.user_id = p.id
     and s.is_active
    where a.id = p_announcement_id;
end;
$$;

-- Staff attention list: dispatches stuck in 'sending' (a process ended mid-delivery) and partial deliveries. These are
-- never retried automatically; an authorised person decides.
-- Runs with the owner's rights because the claim table has no client grants. The staff filter is inside the view body, so
-- non-staff callers receive no rows.
create or replace view public.v_announcement_dispatch_attention
as
select d.announcement_id, d.status, d.claimed_at, d.sending_at, d.finished_at, d.sent_count, d.failed_count
from public.announcement_dispatches d
where public.is_admin_or_coordinator()
  and (d.status = 'partial' or (d.status = 'sending' and d.sending_at < now() - interval '15 minutes'));

revoke all on public.v_announcement_dispatch_attention from public, anon;
grant select on public.v_announcement_dispatch_attention to authenticated;

grant execute on function public.begin_announcement_send(uuid, uuid) to service_role;
grant execute on function public.complete_announcement_dispatch(uuid, uuid, int, int) to service_role;
revoke all on function public.begin_announcement_send(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_announcement_dispatch(uuid, uuid, int, int) from public, anon, authenticated;

-- ─── F. Attendance preservation: a status-unchanged update keeps the stored attended value exactly ─────────────────
-- Before this migration, any update to a legacy row re-derived attended from status, so attended=false on a confirmed
-- row silently became NULL. Now the value is derived only when the status changes, or when attended is written explicitly.
create or replace function public.meeting_attendance_normalise()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.attended is not null and new.attendance_status = 'invited' then
      new.attendance_status := case when new.attended then 'attended' else 'confirmed' end;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.attendance_status is distinct from old.attendance_status then
      null;  -- status changed: attended is derived from it below
    elsif new.attended is distinct from old.attended then
      new.attendance_status := case when new.attended is true then 'attended' else 'confirmed' end;
    else
      -- Nothing about attendance was written: keep the stored values exactly, legacy false included.
      new.attended := old.attended;
      return new;
    end if;
  end if;

  -- An authenticated caller may confirm or excuse themselves, but may never certify their own outcome.
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

-- ─── G. Legacy classification, read-only and staff only. Describes each row without changing it. ─────────────────────
-- attended=true                              -> attended (evidence)
-- status absent                              -> absent (recorded by an organiser)
-- status invited / excused                   -> as stored
-- status confirmed, attended=false           -> legacy_unverified: confirmed, the false is ambiguous, never absent
-- status confirmed, attended NULL            -> confirmed (as stored)
create or replace view public.v_meeting_attendance_classification
with (security_invoker = true)
as
select
  a.id,
  a.meeting_id,
  a.user_id,
  a.attendance_status,
  a.attended,
  case
    when a.attendance_status = 'attended' then 'attended'
    when a.attendance_status = 'absent' then 'absent'
    when a.attendance_status = 'excused' then 'excused'
    when a.attendance_status = 'invited' then 'invited'
    when a.attendance_status = 'confirmed' and a.attended is false then 'legacy_unverified'
    when a.attendance_status = 'confirmed' then 'confirmed'
    else 'unclassified'
  end as target_state
from public.meeting_attendances a
where public.is_admin_or_coordinator();

revoke all on public.v_meeting_attendance_classification from public, anon;
grant select on public.v_meeting_attendance_classification to authenticated;
