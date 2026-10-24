-- 107_website_authorization.sql
--
-- Website Management authorization on the Hub's existing admin RBAC. Replaces the D1/D2 migration 104, which created
-- a second, independent role system (web_roles, web_role_permissions, web_role_assignments). That system is not created
-- here. Forward-only: it changes one check constraint on admin_role_permissions (adds website.* keys) and creates new
-- objects. It does not alter any table, policy, grant or function from migrations 000-106.
--
-- Authority model:
--   * web_is_core_admin(): an ACTIVE profile with role = 'admin' ONLY. Coordinators are excluded on purpose, as in D1.
--   * web_has_permission(key): core admin, OR an active member holding an admin_role_assignments row whose
--     admin_role_permissions contains the key. Evaluated on every call; revocation takes effect at the next call.
--   * has_admin_permission() from 022/023 is NOT used. It returns true for every coordinator, which would give
--     coordinators all website publishing rights implicitly. Coordinators receive website rights only through an
--     explicit assignment, per the approved decision.
--   * Website roles are the Hub's admin_roles. Staff create a role in Hub Admin Role Management and add website.* keys.
--   * Every privileged website write writes one web_audit_log row. The audit table is append-only.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Website permission keys on the Hub's existing permission column
-- ---------------------------------------------------------------------------------------------------------------------

-- The check constraint on admin_role_permissions.permission_key is replaced, not altered in place. The DO block finds the
-- constraint by its definition, so it works whatever name the constraint has in each database.
do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.admin_role_permissions'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%permission_key%';
  if v_name is not null then
    execute format('alter table public.admin_role_permissions drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.admin_role_permissions add constraint admin_role_permissions_permission_key_check check (
  permission_key in (
    'contacts.view_all',
    'contacts.write',
    'attendance.view_all',
    'testimonies.view_all',
    'testimonies.approve',
    'reports.generate',
    'settings.manage_tags',
    'devotionals.manage',
    'notifications.send',
    'integrations.manage',
    'website.pages.edit',
    'website.pages.publish',
    'website.blog.edit',
    'website.blog.publish',
    'website.events.manage',
    'website.events.publish',
    'website.rhapsody.manage',
    'website.rhapsody.publish',
    'website.media.upload',
    'website.media.manage',
    'website.navigation.edit',
    'website.settings.edit',
    'website.settings.publish',
    'website.analytics.view',
    'website.submissions.review'
  )
);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Website permission catalogue (the list the website functions and screens validate against)
-- ---------------------------------------------------------------------------------------------------------------------

create table public.web_permission_catalogue (
  key   text primary key check (key ~ '^website\.[a-z]+\.[a-z]+$'),
  label text not null check (char_length(label) between 1 and 200),
  grp   text not null check (char_length(grp) between 1 and 60)
);

insert into public.web_permission_catalogue (key, label, grp) values
  ('website.pages.edit',         'Edit pages and sections (drafts)',                         'Pages'),
  ('website.pages.publish',      'Publish, roll back or unpublish pages',                    'Pages'),
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
  ('website.submissions.review', 'Review public inquiries and prayer requests',              'Submissions');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Audit log (append-only)
-- ---------------------------------------------------------------------------------------------------------------------

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
set search_path = public
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Authority functions
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_is_core_admin()
returns boolean
language sql
stable
security definer
set search_path = public
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
set search_path = public
as $$
  select
    exists (select 1 from public.web_permission_catalogue c where c.key = p_key)
    and auth.uid() is not null
    and public.is_active_member()
    and (
      public.web_is_core_admin()
      or exists (
        select 1
        from public.admin_role_assignments ara
        join public.admin_role_permissions arp on arp.role_id = ara.role_id
        where ara.user_id = auth.uid()
          and arp.permission_key = p_key
      )
    )
$$;

create or replace function public.web_my_permissions()
returns table (permission_key text)
language sql
stable
security definer
set search_path = public
as $$
  select c.key from public.web_permission_catalogue c where public.web_has_permission(c.key) order by c.key
$$;

create or replace function public._web_require(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.web_has_permission(p_key) then
    raise exception 'You do not have permission for this website action.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public._web_audit(p_action text, p_target text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.web_audit_log (actor_id, actor_type, action, target, details)
  values (
    auth.uid(),
    case when public.web_is_core_admin() then 'core_admin' else 'website_role' end,
    p_action,
    p_target,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Privileges and RLS
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.web_permission_catalogue enable row level security;
alter table public.web_audit_log enable row level security;

revoke all on public.web_permission_catalogue, public.web_audit_log from public, anon, authenticated;
grant select on public.web_permission_catalogue to authenticated;

create policy web_catalogue_read on public.web_permission_catalogue for select to authenticated using (public.is_active_member());
create policy web_audit_core_read on public.web_audit_log for select to authenticated using (public.web_is_core_admin());
grant select on public.web_audit_log to authenticated;

create or replace function public._web_require_core_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.web_is_core_admin() then
    raise exception 'Only a core administrator can manage website roles.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._web_refuse_audit_mutation() from public, anon, authenticated;
revoke all on function public._web_require(text) from public, anon, authenticated;
revoke all on function public._web_require_core_admin() from public, anon, authenticated;
revoke all on function public._web_audit(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.web_is_core_admin() from public, anon;
revoke all on function public.web_has_permission(text) from public, anon;
revoke all on function public.web_my_permissions() from public, anon;

grant execute on function public.web_is_core_admin() to authenticated;
grant execute on function public.web_has_permission(text) to authenticated;
grant execute on function public.web_my_permissions() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Guard on the Hub's own RBAC tables. The Hub's policies (045) let every coordinator write admin_roles,
--    admin_role_permissions and admin_role_assignments. Without this guard a coordinator could grant themselves
--    website.pages.publish and skip the explicit authorization the approved decision requires. Hub keys are untouched.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public._web_guard_website_rbac()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role uuid;
begin
  if tg_table_name = 'admin_role_permissions' then
    if (tg_op <> 'INSERT' and old.permission_key like 'website.%') or (tg_op <> 'DELETE' and new.permission_key like 'website.%') then
      if not public.web_is_core_admin() then
        raise exception 'Only a core administrator can grant or revoke website permissions.' using errcode = '42501';
      end if;
    end if;
  else
    -- admin_role_assignments: any change to a role that carries a website key needs a core administrator.
    for v_role in select distinct x from unnest(array[
        case when tg_op <> 'INSERT' then old.role_id end,
        case when tg_op <> 'DELETE' then new.role_id end]) as x where x is not null loop
      if exists (select 1 from public.admin_role_permissions p where p.role_id = v_role and p.permission_key like 'website.%')
         and not public.web_is_core_admin() then
        raise exception 'Only a core administrator can assign or remove a website role.' using errcode = '42501';
      end if;
    end loop;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger admin_role_permissions_website_guard
  before insert or update or delete on public.admin_role_permissions
  for each row execute function public._web_guard_website_rbac();
create trigger admin_role_assignments_website_guard
  before insert or update or delete on public.admin_role_assignments
  for each row execute function public._web_guard_website_rbac();

revoke all on function public._web_guard_website_rbac() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Core-administrator role management. Each call checks web_is_core_admin(), validates its input, writes the Hub row
--    and writes one web_audit_log row. The Hub's RLS does not let a core administrator write these tables directly, so
--    these functions are the only route, and the guard in section 6 still applies to them.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.web_create_website_role(p_name text, p_description text, p_permissions text[], p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_key text;
begin
  perform public._web_require_core_admin();
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'A role name must be between 2 and 80 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_permissions, 1), 0) > 15 then
    raise exception 'A role can hold at most 15 website permissions.' using errcode = '22023';
  end if;
  -- Every key is checked before anything is written, so a refused key leaves no role behind.
  foreach v_key in array coalesce(p_permissions, '{}') loop
    if not exists (select 1 from public.web_permission_catalogue c where c.key = v_key) then
      raise exception 'That is not a website permission.' using errcode = '22023';
    end if;
  end loop;
  insert into public.admin_roles (name, description, created_by)
  values (btrim(p_name), btrim(coalesce(p_description, '')), auth.uid())
  returning id into v_id;
  insert into public.admin_role_permissions (role_id, permission_key)
  select v_id, k from unnest(coalesce(p_permissions, '{}'::text[])) as k
  on conflict do nothing;
  perform public._web_audit('role.created', v_id::text,
    jsonb_build_object('name', btrim(p_name), 'permissions', coalesce(p_permissions, '{}'::text[]), 'reason', btrim(p_reason)));
  return v_id;
end;
$$;

create or replace function public.web_set_website_permission(p_role_id uuid, p_permission text, p_grant boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._web_require_core_admin();
  if not exists (select 1 from public.web_permission_catalogue c where c.key = p_permission) then
    raise exception 'That is not a website permission.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_roles r where r.id = p_role_id) then
    raise exception 'That role does not exist.' using errcode = 'P0002';
  end if;
  if p_grant then
    insert into public.admin_role_permissions (role_id, permission_key) values (p_role_id, p_permission)
    on conflict do nothing;
    perform public._web_audit('role.permission_granted', p_role_id::text, jsonb_build_object('permission', p_permission, 'reason', btrim(p_reason)));
  else
    delete from public.admin_role_permissions where role_id = p_role_id and permission_key = p_permission;
    perform public._web_audit('role.permission_revoked', p_role_id::text, jsonb_build_object('permission', p_permission, 'reason', btrim(p_reason)));
  end if;
end;
$$;

create or replace function public.web_assign_website_role(p_profile_id uuid, p_role_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._web_require_core_admin();
  if p_profile_id = auth.uid() then
    raise exception 'You cannot assign a website role to yourself.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.status = 'active') then
    raise exception 'Only an active account can be given a website role.' using errcode = '22023';
  end if;
  insert into public.admin_role_assignments (role_id, user_id, assigned_by)
  values (p_role_id, p_profile_id, auth.uid())
  on conflict (role_id, user_id) do nothing
  returning id into v_id;
  if v_id is null then
    select a.id into v_id from public.admin_role_assignments a where a.role_id = p_role_id and a.user_id = p_profile_id;
  end if;
  perform public._web_audit('assignment.created', v_id::text, jsonb_build_object('profile_id', p_profile_id, 'role_id', p_role_id, 'reason', btrim(p_reason)));
  return v_id;
end;
$$;

create or replace function public.web_unassign_website_role(p_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.admin_role_assignments%rowtype;
begin
  perform public._web_require_core_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  delete from public.admin_role_assignments where id = p_assignment_id returning * into v_row;
  if not found then
    raise exception 'That assignment does not exist.' using errcode = 'P0002';
  end if;
  perform public._web_audit('assignment.removed', p_assignment_id::text,
    jsonb_build_object('profile_id', v_row.user_id, 'role_id', v_row.role_id, 'reason', btrim(p_reason)));
end;
$$;

create or replace function public.web_list_website_roles()
returns table (id uuid, name text, description text, permissions text[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._web_require_core_admin();
  return query
    select r.id, r.name, coalesce(r.description, ''),
           coalesce(array(select p.permission_key from public.admin_role_permissions p
                          where p.role_id = r.id and p.permission_key like 'website.%' order by p.permission_key), '{}')
    from public.admin_roles r
    where exists (select 1 from public.admin_role_permissions p where p.role_id = r.id and p.permission_key like 'website.%')
    order by r.name;
end;
$$;

create or replace function public.web_list_website_assignments()
returns table (id uuid, role_id uuid, profile_id uuid, assigned_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._web_require_core_admin();
  return query
    select a.id, a.role_id, a.user_id, a.assigned_at
    from public.admin_role_assignments a
    where exists (select 1 from public.admin_role_permissions p where p.role_id = a.role_id and p.permission_key like 'website.%')
    order by a.assigned_at desc;
end;
$$;

revoke all on function public.web_create_website_role(text, text, text[], text) from public, anon;
revoke all on function public.web_set_website_permission(uuid, text, boolean, text) from public, anon;
revoke all on function public.web_assign_website_role(uuid, uuid, text) from public, anon;
revoke all on function public.web_unassign_website_role(uuid, text) from public, anon;
revoke all on function public.web_list_website_roles() from public, anon;
revoke all on function public.web_list_website_assignments() from public, anon;

grant execute on function public.web_create_website_role(text, text, text[], text) to authenticated;
grant execute on function public.web_set_website_permission(uuid, text, boolean, text) to authenticated;
grant execute on function public.web_assign_website_role(uuid, uuid, text) to authenticated;
grant execute on function public.web_unassign_website_role(uuid, text) to authenticated;
grant execute on function public.web_list_website_roles() to authenticated;
grant execute on function public.web_list_website_assignments() to authenticated;
