-- 089_profile_status_only_via_workflow.sql
--
-- Forward-only. PROPOSED, NOT COMMITTED, NOT APPLIED: diff review and approval first.
--
-- Problem: an admin or coordinator can change any profile's status with a direct authenticated UPDATE. The guard in
-- guard_profile_privileged_columns (048) only checks that the caller is staff. The transition rules in set_member_status
-- (083) and the approval RPCs (016) are therefore bypassed: a rejected account can be reactivated, an active account can
-- be moved to pending, an account can be deactivated without a reason, and no member_status_audit row is written.
--
-- Fix: a status change by any role other than the database owner or service role is refused. The workflow RPCs
-- (approve_pending_member, reject_pending_member, set_member_status) are SECURITY DEFINER functions owned by the
-- database owner, so the guard's owner exemption already covers them and their behaviour is unchanged. The application
-- writes profile status only through those RPCs (verified: the one direct profile UPDATE in src/ writes name, student
-- number and avatar only).
--
-- Unchanged: role and admin_role rules, the rule that staff roles need an active account, the non-staff self-edit
-- restrictions, and the owner and service-role exemption.
--
-- Dependencies: 016 (approve and reject RPCs), 048 (guard_profile_privileged_columns), 080 and 083 (set_member_status).

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
