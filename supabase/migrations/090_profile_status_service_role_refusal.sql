-- 090_profile_status_service_role_refusal.sql
--
-- Forward-only correction to guard_profile_privileged_columns() as applied by 089. 089 is already applied to
-- blw086cert and is not modified. Its exemption list (postgres, supabase_admin, service_role) runs before its status
-- check, so service_role can still change status directly. This refuses status changes for every caller except the
-- database owner (postgres, supabase_admin). The workflow RPCs are SECURITY DEFINER functions owned by postgres, so
-- they reach the check as postgres. service_role is not exempt for status.
--
-- The privilege boundary that does not depend on current_user is in 094 (column privileges). This trigger is the
-- second layer.
--
-- Dependencies: 048 (the guard body), 089 (applied), 080 and 083 (set_member_status), 016 (approve and reject RPCs).
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  actor uuid := auth.uid();
  staff boolean;
  changed text[];
begin
  -- Status is refused for every caller except the database owner. service_role is NOT exempt for status: the workflow
  -- RPCs are SECURITY DEFINER functions owned by postgres, so they reach this check as postgres.
  if new.status is distinct from old.status and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Account status changes go through the approval and status workflow.' using errcode = '42501';
  end if;

  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  staff := public.is_admin_or_coordinator();

  if new.role is distinct from old.role or new.admin_role is distinct from old.admin_role then
    if not public.is_coordinator() then
      raise exception 'Not authorised to change role or admin_role.' using errcode = '42501';
    end if;

    if (new.role in ('admin', 'coordinator', 'cell_leader') or new.admin_role is not null)
       and new.status is distinct from 'active' then
      raise exception 'Staff roles can be assigned only to active accounts.' using errcode = '42501';
    end if;
  end if;

  if not staff then
    if actor is null or new.id <> actor then
      raise exception 'Not authorised to edit this profile.' using errcode = '42501';
    end if;

    if old.status not in ('pending', 'active') then
      raise exception 'Only pending or active accounts may edit ordinary profile fields.' using errcode = '42501';
    end if;

    changed := public.profile_edit_changed_fields(
      to_jsonb(old),
      to_jsonb(new),
      array['email', 'role', 'status', 'cell_id', 'admin_role', 'joined_at', 'person_id']
    );
    if coalesce(array_length(changed, 1), 0) > 0 then
      raise exception 'Not authorised to change protected profile fields: %', array_to_string(changed, ', ') using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;
