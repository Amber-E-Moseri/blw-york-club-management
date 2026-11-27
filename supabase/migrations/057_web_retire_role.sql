-- 057_web_retire_role.sql
-- Website roles: safely retire an unused role (Hub admin_roles). Forward-only. Adds one function; alters no table.
--
-- The website role screens expose create, assign, revoke, permission editing and retirement. Retirement is the one
-- capability the CMS backend (107) did not provide. This function removes a role only when it is not a built-in role
-- and no one holds it, so no access is lost silently. Every retirement writes an audit row.
--
-- Only a core administrator may call it. The RBAC guard (107) also requires a core administrator for any deletion of a
-- website permission row, so the check here and the guard agree.

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
