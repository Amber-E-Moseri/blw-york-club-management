-- Migration 016: Security and authorization hardening
-- Makes database authorization authoritative for privileged profile, directory,
-- contact, meeting, Zoom, export, and approval operations.

-- ---------------------------------------------------------------------------
-- Core authorization helpers
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('pending', 'active', 'rejected')),
  add column if not exists student_number text;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'coordinator', false)
$$;

create or replace function public.is_admin_or_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'coordinator'), false)
$$;

create or replace function public.is_cell_leader_for_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles actor
    join public.profiles target on target.id = target_user_id
    where actor.id = auth.uid()
      and actor.role = 'cell_leader'
      and actor.cell_id is not null
      and actor.cell_id = target.cell_id
  )
$$;

create or replace function public.has_admin_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_or_coordinator()
    or exists (
      select 1
      from public.admin_role_assignments ara
      join public.admin_role_permissions arp on arp.role_id = ara.role_id
      where ara.user_id = auth.uid()
        and arp.permission_key = permission
    )
$$;

-- ---------------------------------------------------------------------------
-- Profiles: no direct self-service writes to privileged fields
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_coordinator on public.profiles;
drop policy if exists "leaders_manage_profiles" on public.profiles;

create policy profiles_select_scoped on public.profiles
  for select using (
    id = auth.uid()
    or public.is_admin_or_coordinator()
    or public.is_cell_leader_for_profile(id)
  );

-- Only coordinators may directly administer profile rows. Member approval is
-- handled by RPCs below so ordinary users and cell leaders cannot modify role,
-- status, cell_id, admin_role, or other privileged membership fields directly.
create policy profiles_coordinator_administer on public.profiles
  for all using (public.is_coordinator())
  with check (public.is_coordinator());

-- A safe directory projection. React may use this for UX, but RLS/RPCs remain
-- the authorization authority.
create or replace view public.member_directory
with (security_invoker = true)
as
select
  p.id,
  p.full_name,
  case when p.id = auth.uid() or public.is_admin_or_coordinator() then p.email else null end as email,
  case when p.id = auth.uid() or public.is_admin_or_coordinator() then p.student_number else null end as student_number,
  p.role,
  p.status,
  p.cell_id,
  p.avatar_url,
  p.joined_at
from public.profiles p
where
  p.id = auth.uid()
  or public.is_admin_or_coordinator()
  or public.is_cell_leader_for_profile(p.id);

grant select on public.member_directory to authenticated;

-- Approval/rejection RPCs. These are the only client-callable paths for status
-- transitions in the approval workflow.
create or replace function public.approve_pending_member(target_member_id uuid)
returns table (id uuid, email text, full_name text, status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to approve members.' using errcode = '42501';
  end if;

  return query
  update public.profiles p
     set status = 'active',
         updated_at = now()
   where p.id = target_member_id
     and p.status = 'pending'
  returning p.id, p.email, p.full_name, p.status;
end;
$$;

create or replace function public.reject_pending_member(target_member_id uuid)
returns table (id uuid, email text, full_name text, status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to reject members.' using errcode = '42501';
  end if;

  return query
  update public.profiles p
     set status = 'rejected',
         updated_at = now()
   where p.id = target_member_id
     and p.status in ('pending', 'rejected')
  returning p.id, p.email, p.full_name, p.status;
end;
$$;

grant execute on function public.approve_pending_member(uuid) to authenticated;
grant execute on function public.reject_pending_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Extended profile privacy
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select" on public.user_profiles;
drop policy if exists "user_profiles_own_select" on public.user_profiles;
drop policy if exists "user_profiles_admin_read" on public.user_profiles;

create policy user_profiles_select_scoped on public.user_profiles
  for select using (
    user_id = auth.uid()
    or public.is_admin_or_coordinator()
    or public.is_cell_leader_for_profile(user_id)
  );

-- Existing own insert/update/delete policies are intentionally preserved.

-- ---------------------------------------------------------------------------
-- Contacts/CRM: scope mutation authority, especially moves/deletes
-- ---------------------------------------------------------------------------

drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;
drop policy if exists contacts_delete on public.contacts;

create policy contacts_insert_scoped on public.contacts
  for insert with check (
    public.is_admin_or_coordinator()
    or public.is_cell_leader_of(cell_id)
  );

create policy contacts_update_scoped on public.contacts
  for update
  using (
    public.is_admin_or_coordinator()
    or public.is_cell_leader_of(cell_id)
  )
  with check (
    public.is_admin_or_coordinator()
    or public.is_cell_leader_of(cell_id)
  );

create policy contacts_delete_admin_only on public.contacts
  for delete using (public.is_admin_or_coordinator());

drop policy if exists "contact_follow_ups_insert" on public.contact_follow_ups;
drop policy if exists "contact_follow_ups_update" on public.contact_follow_ups;

create policy contact_follow_ups_insert_scoped on public.contact_follow_ups
  for insert with check (
    public.is_admin_or_coordinator()
    or exists (
      select 1 from public.contacts c
      where c.id = contact_follow_ups.contact_id
        and public.is_cell_leader_of(c.cell_id)
    )
  );

create policy contact_follow_ups_update_scoped on public.contact_follow_ups
  for update using (
    public.is_admin_or_coordinator()
    or exists (
      select 1 from public.contacts c
      where c.id = contact_follow_ups.contact_id
        and public.is_cell_leader_of(c.cell_id)
    )
  )
  with check (
    public.is_admin_or_coordinator()
    or exists (
      select 1 from public.contacts c
      where c.id = contact_follow_ups.contact_id
        and public.is_cell_leader_of(c.cell_id)
    )
  );

-- Audit logs may only be read/written by explicit admins/coordinators.
drop policy if exists "contact_audit_log_read" on public.contact_audit_log;
drop policy if exists "contact_audit_log_insert" on public.contact_audit_log;

create policy contact_audit_log_read_admin on public.contact_audit_log
  for select using (public.is_admin_or_coordinator());

create policy contact_audit_log_insert_admin on public.contact_audit_log
  for insert with check (
    public.is_admin_or_coordinator()
    and changed_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Admin roles/custom permissions
-- ---------------------------------------------------------------------------

drop policy if exists admin_roles_read on public.admin_roles;
drop policy if exists admin_role_permissions_read on public.admin_role_permissions;
drop policy if exists admin_role_assignments_read on public.admin_role_assignments;

create policy admin_roles_read_explicit on public.admin_roles
  for select using (public.is_admin_or_coordinator());

create policy admin_role_permissions_read_explicit on public.admin_role_permissions
  for select using (public.is_admin_or_coordinator());

create policy admin_role_assignments_read_explicit on public.admin_role_assignments
  for select using (public.is_admin_or_coordinator() or auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Exports
-- ---------------------------------------------------------------------------

create or replace function public.export_members_authorized(export_status text default 'all')
returns table (
  id uuid,
  full_name text,
  email text,
  student_number text,
  role text,
  status text,
  cell_id uuid,
  avatar_url text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('reports.generate') then
    raise exception 'Not authorised to export member data.' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, p.email, p.student_number, p.role, p.status, p.cell_id, p.avatar_url, p.joined_at
  from public.profiles p
  where
    export_status = 'all'
    or (export_status = 'active' and p.status = 'active')
    or (export_status = 'archived' and p.status <> 'active')
  order by p.full_name asc;
end;
$$;

grant execute on function public.export_members_authorized(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Meetings and Zoom
-- ---------------------------------------------------------------------------

drop policy if exists "meetings_manage" on public.meetings;
create policy meetings_manage_scoped on public.meetings
  for all using (
    public.is_admin_or_coordinator()
    or (
      exists (select 1 from public.profiles where id = auth.uid() and role = 'cell_leader')
      and (created_by = auth.uid() or public.is_cell_leader_of(cell_id))
    )
  )
  with check (
    public.is_admin_or_coordinator()
    or (
      exists (select 1 from public.profiles where id = auth.uid() and role = 'cell_leader')
      and created_by = auth.uid()
      and public.is_cell_leader_of(cell_id)
    )
  );

drop policy if exists "zoom_attendance_admin_read" on public.zoom_attendance;
create policy zoom_attendance_read_scoped on public.zoom_attendance
  for select using (
    public.is_admin_or_coordinator()
    or exists (
      select 1
      from public.meetings m
      where m.id = zoom_attendance.meeting_id
        and (m.created_by = auth.uid() or public.is_cell_leader_of(m.cell_id))
    )
  );

drop policy if exists "zoom_settings_admin" on public.zoom_settings;
create policy zoom_settings_admin_explicit on public.zoom_settings
  for all using (public.has_admin_permission('integrations.manage'))
  with check (public.has_admin_permission('integrations.manage'));
