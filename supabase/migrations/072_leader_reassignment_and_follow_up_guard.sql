-- 072: one authority path for follow-up assignment, including reassignment, and a database guard on direct inserts.
-- The eligibility check lives in one internal helper. assign_contact_follow_up (071) is re-declared to call it, with the
-- same behaviour. reassign_contact_follow_up performs the reassignment in one transaction for a leader or staff member,
-- taking a member key rather than an auth user id. Forward-only.

-- ─── Shared authority and eligibility: internal, not executable by clients ───────────────────────────────────────────
create or replace function public._resolve_contact_assignee(p_contact_id uuid, p_member_key text)
returns uuid
language plpgsql
stable
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

  return v_target;
end;
$$;

revoke all on function public._resolve_contact_assignee(uuid, text) from public, anon, authenticated;

-- ─── Assignment (re-declared; same behaviour as 071, now through the shared helper) ──────────────────────────────────
create or replace function public.assign_contact_follow_up(p_contact_id uuid, p_member_key text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid := public._resolve_contact_assignee(p_contact_id, p_member_key);
begin
  update public.contacts set follow_up_assignee = v_target where id = p_contact_id;
  return p_member_key;
end;
$$;

-- ─── Reassignment: closes the active follow-up, opens the new one, sets the contact, and writes the audit entry ─────────
create or replace function public.reassign_contact_follow_up(p_contact_id uuid, p_member_key text, p_notes text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target uuid := public._resolve_contact_assignee(p_contact_id, p_member_key);
begin
  update public.contact_follow_ups
  set status = 'reassigned', updated_at = now()
  where contact_id = p_contact_id and status = 'active';

  insert into public.contact_follow_ups (contact_id, assigned_to, assigned_by, notes, status)
  values (p_contact_id, v_target, v_actor, p_notes, 'active');

  update public.contacts set follow_up_assignee = v_target where id = p_contact_id;

  insert into public.contact_audit_log (contact_id, action, changed_by, change_details, reason)
  values (p_contact_id, 'reassigned', v_actor, jsonb_build_object('assignee_member_key', p_member_key), p_notes);

  return p_member_key;
end;
$$;

revoke all on function public.reassign_contact_follow_up(uuid, text, text) from public, anon;
grant execute on function public.reassign_contact_follow_up(uuid, text, text) to authenticated;
revoke all on function public.assign_contact_follow_up(uuid, text) from public, anon;
grant execute on function public.assign_contact_follow_up(uuid, text) to authenticated;

-- ─── Direct inserts into contact_follow_ups: the same eligibility, at the database boundary ──────────────────────────
create or replace function public.contact_follow_ups_guard_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_cell uuid;
begin
  if v_actor is null then
    return new;  -- service-role and migration writers
  end if;
  if public.is_admin_or_coordinator() or new.assigned_to = v_actor then
    return new;
  end if;
  select c.cell_id into v_cell from public.contacts c where c.id = new.contact_id;
  if v_cell is not null
    and exists (select 1 from public.cells k where k.id = v_cell and k.leader_id = v_actor)
    and exists (select 1 from public.profiles p where p.id = new.assigned_to and p.cell_id = v_cell and p.status = 'active')
  then
    return new;
  end if;
  raise exception 'follow-up may be assigned only to an active member of the contact''s cell' using errcode = '42501';
end;
$$;

revoke all on function public.contact_follow_ups_guard_assignee() from public, anon, authenticated;

drop trigger if exists contact_follow_ups_guard_assignee on public.contact_follow_ups;
create trigger contact_follow_ups_guard_assignee
  before insert on public.contact_follow_ups
  for each row execute function public.contact_follow_ups_guard_assignee();

-- ─── Cell names with their leader's name, for active members only (no ids, no contact data) ─────────────────────────────
-- Leaders of other cells are organizational information, shown to active members of the Hub. The function returns only
-- the cell id, cell name and the leader's display name.
create or replace function public.list_cell_leaders()
returns table (cell_id uuid, cell_name text, leader_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, p.full_name
  from public.cells c
  left join public.profiles p on p.id = c.leader_id and p.status = 'active'
  where public.is_active_member();
$$;

revoke all on function public.list_cell_leaders() from public, anon;
grant execute on function public.list_cell_leaders() to authenticated;

-- ─── Person lookup for contact logging: an active leader or staff member learns only whether an exact email is on file ─
-- Returns the person id and nothing else. Members and anonymous callers receive null.
create or replace function public.find_person_id_for_contact(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.people p
  where public.is_active_member()
    and (
      public.is_admin_or_coordinator()
      or exists (select 1 from public.cells c where c.leader_id = auth.uid())
    )
    and public.normalize_identity_email(p_email) is not null
    and public.normalize_identity_email(p.email) = public.normalize_identity_email(p_email)
  limit 1
$$;

revoke all on function public.find_person_id_for_contact(text) from public, anon;
grant execute on function public.find_person_id_for_contact(text) to authenticated;
