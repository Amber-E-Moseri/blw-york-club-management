-- 048_role_assignment_guards.sql
--
-- Staff privileges (admin, coordinator, cell_leader, or any admin_role) may be assigned only to an active account.
-- Before this migration, a coordinator could set role = 'admin' on a pending or rejected profile, which the profile
-- would then carry into the day it is approved or reactivated.
--
-- Changes: guard_profile_privileged_columns() gains one check. When role or admin_role changes to a staff value,
-- the resulting status must be 'active'. The existing checks, the bypass for postgres/supabase_admin/service_role,
-- and the non-staff protections are unchanged.
-- Forward-only: create or replace of the trigger function. No table, policy, grant or existing migration change.

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

  if new.status is distinct from old.status then
    if not staff then
      raise exception 'Not authorised to change account status.' using errcode = '42501';
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
