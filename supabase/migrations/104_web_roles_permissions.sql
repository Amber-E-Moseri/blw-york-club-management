-- 104_web_roles_permissions.sql
--
-- Website Management roles and permissions (Phase D1 section 5). Forward-only. Creates new objects only. Does not
-- alter any table, policy, grant or function from migrations 000-103, and does not touch the Hub's admin_roles,
-- admin_role_permissions or admin_role_assignments.
--
-- Authority model:
--   * web_is_core_admin(): an ACTIVE profile with role = 'admin' ONLY. Coordinators are excluded on purpose. They get
--     no website rights automatically. (is_core_admin() from 022 includes coordinators, so it is not reused here.)
--   * web_has_permission(key): core admin, or an active website role assignment that grants the key. Evaluated on every
--     call. Revocation takes effect at the next call.
--   * Role management (create, edit, archive, assign, revoke) is core-admin only in phase 1. A role holding
--     website.roles.manage does not let its holder manage roles.
--   * Every privileged write writes one web_audit_log row. The audit table is append-only.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Controlled catalogue
-- ---------------------------------------------------------------------------------------------------------------------

create table public.web_permission_catalogue (
  key   text primary key check (key ~ '^website\.[a-z]+\.[a-z]+$'),
  label text not null check (char_length(label) between 1 and 200),
  grp   text not null check (char_length(grp) between 1 and 60)
);

insert into public.web_permission_catalogue (key, label, grp) values
  ('website.pages.edit',         'Edit pages and sections (drafts)',                         'Pages'),
  ('website.pages.publish',      'Publish or roll back pages',                               'Pages'),
  ('website.blog.edit',          'Create and edit blog drafts',                              'Blog'),
  ('website.blog.publish',       'Publish, schedule, unpublish or archive posts',            'Blog'),
  ('website.events.manage',      'Choose and edit public events',                            'Events'),
  ('website.events.publish',     'Make an event public or withdraw it',                      'Events'),
  ('website.rhapsody.manage',    'Create and edit Rhapsody editions and PDFs',               'Rhapsody'),
  ('website.rhapsody.publish',   'Publish or archive editions (needs an authorizer)',        'Rhapsody'),
  ('website.media.upload',       'Upload images and PDFs',                                   'Media'),
  ('website.media.manage',       'Edit alt text, archive or replace media',                  'Media'),
  ('website.navigation.edit',    'Edit menus and links',                                     'Navigation'),
  ('website.settings.edit',      'Edit identity, contact, service times, socials, SEO',      'Settings'),
  ('website.settings.publish',   'Publish settings changes',                                 'Settings'),
  ('website.analytics.view',     'View aggregated download and visitor analytics',           'Analytics'),
  ('website.submissions.review', 'Review public inquiries and prayer requests',              'Submissions'),
  ('website.roles.manage',       'Create, assign and revoke website roles (inert in phase 1)', 'People and roles');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Roles, grants, assignments, audit
-- ---------------------------------------------------------------------------------------------------------------------

create table public.web_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  is_builtin  boolean not null default false,
  status      text not null default 'active' check (status in ('active', 'archived')),
  version     integer not null default 1 check (version >= 1),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

create table public.web_role_permissions (
  role_id        uuid not null references public.web_roles (id) on delete cascade,
  permission_key text not null references public.web_permission_catalogue (key),
  granted_by     uuid,
  granted_at     timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table public.web_role_assignments (
  id            uuid primary key default gen_random_uuid(),
  role_id       uuid not null references public.web_roles (id),
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  assigned_by   uuid not null,
  assigned_at   timestamptz not null default now(),
  reason        text not null check (char_length(btrim(reason)) between 5 and 500),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 5 and 500),
  check ((revoked_at is null) = (revoke_reason is null))
);

create unique index web_role_assignments_one_active on public.web_role_assignments (role_id, profile_id)
  where revoked_at is null;
create index web_role_assignments_profile on public.web_role_assignments (profile_id) where revoked_at is null;

create table public.web_audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  actor_type text not null check (actor_type in ('core_admin', 'website_role', 'public')),
  action     text not null check (char_length(action) between 1 and 80),
  target     text,
  details    jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create or replace function public._web_refuse_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Website audit records cannot be changed or removed.' using errcode = '42501';
end;
$$;

create trigger web_audit_log_append_only
  before update or delete on public.web_audit_log
  for each row execute function public._web_refuse_audit_mutation();
create trigger web_audit_log_no_truncate
  before truncate on public.web_audit_log
  for each statement execute function public._web_refuse_audit_mutation();

-- Seeded built-in roles (fixed ids so tests and the client can refer to them). Grants follow D1 section 5.3.
insert into public.web_roles (id, name, description, is_builtin) values
  ('7a000000-0000-4000-8000-000000000001', 'Website Administrator', 'Runs the public website. Cannot manage roles.', true),
  ('7a000000-0000-4000-8000-000000000002', 'Website Editor',        'Edits content and menus. Cannot publish.', true),
  ('7a000000-0000-4000-8000-000000000003', 'Website Publisher',     'Edits and publishes content and settings.', true),
  ('7a000000-0000-4000-8000-000000000004', 'Website Contributor',   'Writes blog drafts and uploads media. Cannot publish.', true),
  ('7a000000-0000-4000-8000-000000000005', 'Website Analyst',       'Reads aggregated analytics only.', true);

insert into public.web_role_permissions (role_id, permission_key) values
  ('7a000000-0000-4000-8000-000000000001', 'website.pages.edit'), ('7a000000-0000-4000-8000-000000000001', 'website.pages.publish'),
  ('7a000000-0000-4000-8000-000000000001', 'website.blog.edit'), ('7a000000-0000-4000-8000-000000000001', 'website.blog.publish'),
  ('7a000000-0000-4000-8000-000000000001', 'website.events.manage'), ('7a000000-0000-4000-8000-000000000001', 'website.events.publish'),
  ('7a000000-0000-4000-8000-000000000001', 'website.rhapsody.manage'), ('7a000000-0000-4000-8000-000000000001', 'website.rhapsody.publish'),
  ('7a000000-0000-4000-8000-000000000001', 'website.media.upload'), ('7a000000-0000-4000-8000-000000000001', 'website.media.manage'),
  ('7a000000-0000-4000-8000-000000000001', 'website.navigation.edit'), ('7a000000-0000-4000-8000-000000000001', 'website.settings.edit'),
  ('7a000000-0000-4000-8000-000000000001', 'website.settings.publish'), ('7a000000-0000-4000-8000-000000000001', 'website.analytics.view'),
  ('7a000000-0000-4000-8000-000000000001', 'website.submissions.review'),
  ('7a000000-0000-4000-8000-000000000002', 'website.pages.edit'), ('7a000000-0000-4000-8000-000000000002', 'website.blog.edit'),
  ('7a000000-0000-4000-8000-000000000002', 'website.events.manage'), ('7a000000-0000-4000-8000-000000000002', 'website.rhapsody.manage'),
  ('7a000000-0000-4000-8000-000000000002', 'website.media.upload'), ('7a000000-0000-4000-8000-000000000002', 'website.media.manage'),
  ('7a000000-0000-4000-8000-000000000002', 'website.navigation.edit'),
  ('7a000000-0000-4000-8000-000000000003', 'website.pages.edit'), ('7a000000-0000-4000-8000-000000000003', 'website.pages.publish'),
  ('7a000000-0000-4000-8000-000000000003', 'website.blog.edit'), ('7a000000-0000-4000-8000-000000000003', 'website.blog.publish'),
  ('7a000000-0000-4000-8000-000000000003', 'website.events.manage'), ('7a000000-0000-4000-8000-000000000003', 'website.events.publish'),
  ('7a000000-0000-4000-8000-000000000003', 'website.rhapsody.manage'), ('7a000000-0000-4000-8000-000000000003', 'website.rhapsody.publish'),
  ('7a000000-0000-4000-8000-000000000003', 'website.media.upload'), ('7a000000-0000-4000-8000-000000000003', 'website.settings.publish'),
  ('7a000000-0000-4000-8000-000000000004', 'website.blog.edit'), ('7a000000-0000-4000-8000-000000000004', 'website.media.upload'),
  ('7a000000-0000-4000-8000-000000000005', 'website.analytics.view');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Authority functions
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_is_core_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role = 'admin'
  )
$$;

create or replace function public.web_has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.web_permission_catalogue c where c.key = p_key)
    and auth.uid() is not null
    and (
      public.web_is_core_admin()
      or (
        public.is_active_profile(auth.uid())
        and exists (
          select 1
          from public.web_role_assignments a
          join public.web_roles r on r.id = a.role_id and r.status = 'active'
          join public.web_role_permissions rp on rp.role_id = r.id and rp.permission_key = p_key
          where a.profile_id = auth.uid() and a.revoked_at is null
        )
      )
    )
$$;

create or replace function public.web_my_permissions()
returns table (permission_key text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.key from public.web_permission_catalogue c where public.web_has_permission(c.key) order by c.key
$$;

-- Helper for RPCs: raise a permission error with a stable code the client can map.
create or replace function public._web_require(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.web_has_permission(p_key) then
    raise exception 'You do not have permission for this website action.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public._web_require_core_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.web_is_core_admin() then
    raise exception 'Only a core administrator can manage website roles.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public._web_audit(p_action text, p_target text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.web_audit_log (actor_id, actor_type, action, target, details)
  values (auth.uid(), case when public.web_is_core_admin() then 'core_admin' else 'website_role' end, p_action, p_target, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Role management RPCs (core administrators only)
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_create_role(p_name text, p_description text, p_permissions text[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_key text;
begin
  perform public._web_require_core_admin();
  if p_permissions is null or cardinality(p_permissions) > 16 then
    raise exception 'A custom role takes between 0 and 16 permissions.' using errcode = '22023';
  end if;
  insert into public.web_roles (id, name, description, is_builtin, created_by, updated_by)
  values (v_id, btrim(p_name), coalesce(p_description, ''), false, auth.uid(), auth.uid());
  foreach v_key in array coalesce(p_permissions, '{}') loop
    if not exists (select 1 from public.web_permission_catalogue where key = v_key) then
      raise exception 'Unknown website permission: %', v_key using errcode = '22023';
    end if;
    insert into public.web_role_permissions (role_id, permission_key, granted_by) values (v_id, v_key, auth.uid());
  end loop;
  perform public._web_audit('role.created', v_id::text, jsonb_build_object('name', btrim(p_name), 'permissions', p_permissions));
  return v_id;
end;
$$;

create or replace function public.web_set_role_permissions(p_role_id uuid, p_permissions text[], p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.web_roles%rowtype;
  v_key text;
  v_before text[];
begin
  perform public._web_require_core_admin();
  select * into v_role from public.web_roles where id = p_role_id for update;
  if not found then raise exception 'Role not found.' using errcode = 'P0002'; end if;
  if v_role.version <> p_expected_version then
    raise exception 'This role changed while you were editing. Reload and try again.' using errcode = '40001';
  end if;
  if cardinality(coalesce(p_permissions, '{}')) > 16 then
    raise exception 'A role takes at most 16 permissions.' using errcode = '22023';
  end if;
  select array_agg(permission_key order by permission_key) into v_before from public.web_role_permissions where role_id = p_role_id;
  delete from public.web_role_permissions where role_id = p_role_id;
  foreach v_key in array coalesce(p_permissions, '{}') loop
    if not exists (select 1 from public.web_permission_catalogue where key = v_key) then
      raise exception 'Unknown website permission: %', v_key using errcode = '22023';
    end if;
    insert into public.web_role_permissions (role_id, permission_key, granted_by) values (p_role_id, v_key, auth.uid());
  end loop;
  update public.web_roles set version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = p_role_id returning version into v_role.version;
  perform public._web_audit('role.permissions_changed', p_role_id::text,
    jsonb_build_object('before', v_before, 'after', coalesce(p_permissions, '{}')));
  return v_role.version;
end;
$$;

create or replace function public.web_archive_role(p_role_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform public._web_require_core_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  update public.web_roles set status = 'archived', updated_by = auth.uid(), updated_at = now(), version = version + 1
    where id = p_role_id and status = 'active';
  if not found then raise exception 'Active role not found.' using errcode = 'P0002'; end if;
  update public.web_role_assignments set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Role archived: ' || btrim(p_reason)
    where role_id = p_role_id and revoked_at is null;
  get diagnostics v_count = row_count;
  perform public._web_audit('role.archived', p_role_id::text, jsonb_build_object('reason', btrim(p_reason), 'assignments_revoked', v_count));
end;
$$;

create or replace function public.web_assign_role(p_profile_id uuid, p_role_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public._web_require_core_admin();
  if p_profile_id = auth.uid() then
    raise exception 'You cannot assign a website role to yourself.' using errcode = '42501';
  end if;
  if not public.is_active_profile(p_profile_id) then
    raise exception 'Website roles can only be assigned to an active account.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.web_roles where id = p_role_id and status = 'active') then
    raise exception 'Active role not found.' using errcode = 'P0002';
  end if;
  insert into public.web_role_assignments (role_id, profile_id, assigned_by, reason)
  values (p_role_id, p_profile_id, auth.uid(), btrim(coalesce(p_reason, '')))
  returning id into v_id;
  perform public._web_audit('assignment.created', v_id::text,
    jsonb_build_object('profile_id', p_profile_id, 'role_id', p_role_id, 'reason', btrim(coalesce(p_reason, ''))));
  return v_id;
end;
$$;

create or replace function public.web_revoke_assignment(p_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.web_role_assignments%rowtype;
begin
  perform public._web_require_core_admin();
  select * into v_row from public.web_role_assignments where id = p_assignment_id for update;
  if not found or v_row.revoked_at is not null then
    raise exception 'Active assignment not found.' using errcode = 'P0002';
  end if;
  update public.web_role_assignments set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(coalesce(p_reason, ''))
    where id = p_assignment_id;
  perform public._web_audit('assignment.revoked', p_assignment_id::text,
    jsonb_build_object('profile_id', v_row.profile_id, 'role_id', v_row.role_id, 'reason', btrim(coalesce(p_reason, ''))));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Privileges and row-level security
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.web_permission_catalogue enable row level security;
alter table public.web_roles enable row level security;
alter table public.web_role_permissions enable row level security;
alter table public.web_role_assignments enable row level security;
alter table public.web_audit_log enable row level security;

revoke all on public.web_permission_catalogue, public.web_roles, public.web_role_permissions,
  public.web_role_assignments, public.web_audit_log from public, anon, authenticated;

create policy web_catalogue_read on public.web_permission_catalogue for select to authenticated using (true);
create policy web_roles_core_read on public.web_roles for select to authenticated using (public.web_is_core_admin());
create policy web_role_permissions_core_read on public.web_role_permissions for select to authenticated using (public.web_is_core_admin());
create policy web_assignments_read on public.web_role_assignments for select to authenticated
  using (public.web_is_core_admin() or profile_id = auth.uid());
create policy web_audit_core_read on public.web_audit_log for select to authenticated using (public.web_is_core_admin());

grant select on public.web_permission_catalogue to authenticated;
grant select on public.web_roles, public.web_role_permissions, public.web_role_assignments to authenticated;
grant select on public.web_audit_log to authenticated;

-- Helpers and internal functions: no client execution.
revoke all on function public._web_refuse_audit_mutation() from public, anon, authenticated;
revoke all on function public._web_require(text) from public, anon, authenticated;
revoke all on function public._web_require_core_admin() from public, anon, authenticated;
revoke all on function public._web_audit(text, text, jsonb) from public, anon, authenticated;

revoke all on function public.web_is_core_admin() from public, anon;
revoke all on function public.web_has_permission(text) from public, anon;
revoke all on function public.web_my_permissions() from public, anon;
revoke all on function public.web_create_role(text, text, text[]) from public, anon;
revoke all on function public.web_set_role_permissions(uuid, text[], integer) from public, anon;
revoke all on function public.web_archive_role(uuid, text) from public, anon;
revoke all on function public.web_assign_role(uuid, uuid, text) from public, anon;
revoke all on function public.web_revoke_assignment(uuid, text) from public, anon;

grant execute on function public.web_is_core_admin() to authenticated;
grant execute on function public.web_has_permission(text) to authenticated;
grant execute on function public.web_my_permissions() to authenticated;
grant execute on function public.web_create_role(text, text, text[]) to authenticated;
grant execute on function public.web_set_role_permissions(uuid, text[], integer) to authenticated;
grant execute on function public.web_archive_role(uuid, text) to authenticated;
grant execute on function public.web_assign_role(uuid, uuid, text) to authenticated;
grant execute on function public.web_revoke_assignment(uuid, text) to authenticated;
