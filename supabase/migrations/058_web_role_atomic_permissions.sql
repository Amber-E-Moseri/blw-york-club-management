-- 058_web_role_atomic_permissions.sql
-- Website roles: atomic permission changes, and retirement limited to website roles. Forward-only.
--
-- 1. web_set_website_role_permissions sets a role's complete website permission set in ONE transaction. Every key is
--    validated before anything is written, so a bad key or an empty set leaves the role exactly as it was. The Hub
--    previously called web_set_website_permission once per key, so a failure part way left the role half-configured.
--    Grants and revocations are audited with the existing action names (role.permission_granted / _revoked).
-- 2. web_retire_website_role (057) now refuses a role that holds no website permission. Non-website operational roles
--    in admin_roles are not website roles and must not be retired from the website screens.
--
-- Only a core administrator may call either function. The RBAC guard (047) still applies to every row written.

create or replace function public.web_set_website_role_permissions(p_role_id uuid, p_permissions text[], p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key     text;
  v_desired text[] := coalesce(p_permissions, '{}'::text[]);
  v_current text[];
  v_added   text[];
  v_removed text[];
begin
  perform public._web_require_core_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  -- Lock the role so two administrators cannot interleave changes to the same role.
  perform 1 from public.admin_roles r where r.id = p_role_id for update;
  if not found then
    raise exception 'That role does not exist.' using errcode = 'P0002';
  end if;
  if coalesce(array_length(v_desired, 1), 0) = 0 then
    raise exception 'A role needs at least one website permission. Retire the role instead.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_desired, 1), 0) > 15 then
    raise exception 'A role can hold at most 15 website permissions.' using errcode = '22023';
  end if;
  -- Validate every key before the first write.
  foreach v_key in array v_desired loop
    if v_key not like 'website.%' or not exists (select 1 from public.web_permission_catalogue c where c.key = v_key) then
      raise exception 'That is not a website permission.' using errcode = '22023';
    end if;
  end loop;

  select coalesce(array_agg(p.permission_key order by p.permission_key), '{}'::text[]) into v_current
  from public.admin_role_permissions p
  where p.role_id = p_role_id and p.permission_key like 'website.%';

  select coalesce(array_agg(k order by k), '{}'::text[]) into v_added
  from unnest(v_desired) k where not (k = any (v_current));
  select coalesce(array_agg(k order by k), '{}'::text[]) into v_removed
  from unnest(v_current) k where not (k = any (v_desired));

  insert into public.admin_role_permissions (role_id, permission_key)
  select p_role_id, k from unnest(v_added) k
  on conflict do nothing;
  delete from public.admin_role_permissions
  where role_id = p_role_id and permission_key like 'website.%' and permission_key = any (v_removed);

  foreach v_key in array v_added loop
    perform public._web_audit('role.permission_granted', p_role_id::text,
      jsonb_build_object('permission', v_key, 'reason', btrim(p_reason)));
  end loop;
  foreach v_key in array v_removed loop
    perform public._web_audit('role.permission_revoked', p_role_id::text,
      jsonb_build_object('permission', v_key, 'reason', btrim(p_reason)));
  end loop;
end;
$$;

revoke all on function public.web_set_website_role_permissions(uuid, text[], text) from public, anon;
grant execute on function public.web_set_website_role_permissions(uuid, text[], text) to authenticated;

-- Retirement: website roles only (replaces the 057 definition).
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
  delete from public.admin_role_permissions where role_id = p_role_id;
  delete from public.admin_roles where id = p_role_id;
  perform public._web_audit('role.retired', p_role_id::text,
    jsonb_build_object('name', v_name, 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.web_retire_website_role(uuid, text) from public, anon;
grant execute on function public.web_retire_website_role(uuid, text) to authenticated;
