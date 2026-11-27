-- 059_web_role_non_empty_permissions.sql
-- Website roles must always hold at least one website permission. Forward-only.
--
-- 1. web_create_website_role refuses a null or empty permission set before anything is written. Keys are validated
--    before the insert, and the role and its permissions are written in one function call, so a refused request leaves
--    no role row behind.
-- 2. A row trigger on admin_role_permissions refuses the removal of a role's last website permission. It covers every
--    path: web_set_website_permission (revoke), direct table writes, and cascaded deletes. Operational permissions
--    (non-website keys) on the same role are not counted and are not affected.
-- 3. web_retire_website_role is the only sanctioned way to remove a website role's permissions. It marks the role for
--    the rest of its own transaction (set_config, local), so the trigger lets that one role's permissions go. Any other
--    role remains protected.
-- 4. web_set_website_permission (revoke) keeps its signature and audit. The trigger supplies the refusal.
--
-- Existing empty website roles are NOT changed here. A role with no permissions cannot be told apart from an
-- operational role with no permissions by the database, so nothing is deleted or altered automatically. See
-- supabase/verification/website_empty_roles_report.sql for the read-only report and the recovery steps.

create or replace function public.web_create_website_role(p_name text, p_description text, p_permissions text[], p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
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
  if p_permissions is null or cardinality(p_permissions) = 0 then
    raise exception 'A role needs at least one website permission.' using errcode = '22023';
  end if;
  if cardinality(p_permissions) > 15 then
    raise exception 'A role can hold at most 15 website permissions.' using errcode = '22023';
  end if;
  -- Every key is checked before anything is written, so a refused key leaves no role behind.
  foreach v_key in array p_permissions loop
    if v_key is null or not exists (select 1 from public.web_permission_catalogue c where c.key = v_key) then
      raise exception 'That is not a website permission.' using errcode = '22023';
    end if;
  end loop;
  insert into public.admin_roles (name, description, created_by)
  values (btrim(p_name), btrim(coalesce(p_description, '')), auth.uid())
  returning id into v_id;
  insert into public.admin_role_permissions (role_id, permission_key)
  select v_id, k from unnest(p_permissions) as k
  on conflict do nothing;
  perform public._web_audit('role.created', v_id::text,
    jsonb_build_object('name', btrim(p_name), 'permissions', p_permissions, 'reason', btrim(p_reason)));
  return v_id;
end;
$$;

revoke all on function public.web_create_website_role(text, text, text[], text) from public, anon;
grant execute on function public.web_create_website_role(text, text, text[], text) to authenticated;

-- The guard. A website role keeps at least one website key. Deleting or changing the last one is refused, whatever
-- statement does it. The retirement function sets blw.retiring_role for its own role inside its own transaction.
create or replace function public._web_guard_last_website_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_remaining integer;
begin
  -- An UPDATE that keeps the same website key on the same role removes nothing.
  if tg_op = 'UPDATE' and old.permission_key like 'website.%'
     and new.role_id = old.role_id and new.permission_key = old.permission_key then
    return new;
  end if;
  if old.permission_key like 'website.%' then
    if current_setting('blw.retiring_role', true) is distinct from old.role_id::text then
      select count(*) into v_remaining
      from public.admin_role_permissions p
      where p.role_id = old.role_id
        and p.permission_key like 'website.%'
        and not (p.role_id = old.role_id and p.permission_key = old.permission_key);
      if v_remaining = 0 then
        raise exception 'A role needs at least one website permission. Retire the role instead.' using errcode = '22023';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public._web_guard_last_website_permission() from public, anon, authenticated;

drop trigger if exists admin_role_permissions_last_website_guard on public.admin_role_permissions;
create trigger admin_role_permissions_last_website_guard
  before update or delete on public.admin_role_permissions
  for each row execute function public._web_guard_last_website_permission();

-- Retirement (replaces the 058 definition). Same checks as 058; it also marks its own role for the guard.
create or replace function public.web_retire_website_role(p_role_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name   text;
  v_system boolean;
begin
  perform public._web_require_core_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  select r.name, r.is_system into v_name, v_system
  from public.admin_roles r where r.id = p_role_id for update;
  if not found then
    raise exception 'That role does not exist.' using errcode = 'P0002';
  end if;
  if v_system then
    raise exception 'A built-in role cannot be retired.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_role_permissions p where p.role_id = p_role_id and p.permission_key like 'website.%') then
    raise exception 'Only a website role can be retired here.' using errcode = '22023';
  end if;
  if exists (select 1 from public.admin_role_assignments a where a.role_id = p_role_id) then
    raise exception 'Revoke every assignment of this role before retiring it.' using errcode = '22023';
  end if;
  -- Only this role, only inside this transaction, may lose its last website permission.
  perform set_config('blw.retiring_role', p_role_id::text, true);
  delete from public.admin_role_permissions where role_id = p_role_id;
  delete from public.admin_roles where id = p_role_id;
  perform public._web_audit('role.retired', p_role_id::text,
    jsonb_build_object('name', v_name, 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.web_retire_website_role(uuid, text) from public, anon;
grant execute on function public.web_retire_website_role(uuid, text) to authenticated;
