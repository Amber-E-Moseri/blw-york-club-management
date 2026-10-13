-- 083_member_status_transitions_and_staff_guard.sql
--
-- Forward-only correction to set_member_status() (080). 080 may already be deployed, so it is replaced here, not edited.
--
-- Closes three gaps in 080:
--   1. Staff accounts. Any admin or coordinator could change any other staff account's status, including deactivating
--      another coordinator. Now: a coordinator's status cannot be changed through this path, and an admin account (or
--      an account holding an admin_role) can be changed only by a coordinator.
--   2. Reactivation bypassed approval. 080 allowed rejected -> active and pending -> inactive -> active, both of which
--      skip approve_pending_member and its approval email. Activation now happens only from inactive, which is reachable
--      only from an account that was active. A rejected account can only be reopened as pending, and then approved on
--      the approvals page like any other pending account.
--   3. Pending accounts. Pending accounts leave the pending state only through approve_pending_member and
--      reject_pending_member. set_member_status refuses them.
--
-- Allowed transitions (anything else is refused with a message that names the allowed path):
--   active   -> inactive
--   inactive -> active      (a member who was approved before and has been deactivated)
--   rejected -> pending     (reopened for the approval page)
--
-- Unchanged from 080: caller must be an active admin or coordinator, no self-change, a valid status, a reason
-- (recorded in member_status_audit), one row written, and the audit row in the same transaction. Profile RLS is
-- unchanged: direct UPDATE on profiles is still coordinator-only.
--
-- Dependencies: 016 (is_admin_or_coordinator, current_user_role, approve_pending_member), 022 (profile RLS),
-- 048 (admin_role rules), 080 (member_status_audit, the function being replaced).

create or replace function public.set_member_status(p_member_id uuid, p_status text, p_reason text default null)
returns table (member_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_from       text;
  v_role       text;
  v_admin_role text;
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
  v_rows       int;
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to change member status.' using errcode = '42501';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'You cannot change your own account status.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'active', 'inactive', 'rejected') then
    raise exception 'Choose a valid status: pending, active, inactive or rejected.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for this change.' using errcode = '22023';
  end if;

  select p.status, p.role, p.admin_role
    into v_from, v_role, v_admin_role
    from public.profiles p
   where p.id = p_member_id
   for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;

  -- Staff accounts. Checked before the no-op test, so a refused caller learns nothing about another staff account.
  -- A coordinator's status is changed by the database owner, not through this path.
  if v_role = 'coordinator' then
    raise exception 'Coordinator accounts cannot be changed from this page.' using errcode = '42501';
  end if;
  if (v_role = 'admin' or v_admin_role is not null) and not public.is_coordinator() then
    raise exception 'Only a coordinator can change an admin account''s status.' using errcode = '42501';
  end if;

  if v_from = p_status then
    raise exception 'The member already has that status.' using errcode = 'P0001';
  end if;

  -- Transitions. Activation is reachable only from inactive, so no path skips approve_pending_member.
  if not (
       (v_from = 'active' and p_status = 'inactive')
    or (v_from = 'inactive' and p_status = 'active')
    or (v_from = 'rejected' and p_status = 'pending')
  ) then
    if v_from = 'pending' then
      raise exception 'Pending accounts are approved or rejected on the approvals page.' using errcode = 'P0001';
    end if;
    if p_status = 'active' and v_from = 'rejected' then
      raise exception 'A rejected member cannot be reactivated here. Reopen the account as pending, then approve it on the approvals page.'
        using errcode = 'P0001';
    end if;
    raise exception 'That change is not allowed from % to %.', v_from, p_status using errcode = 'P0001';
  end if;

  update public.profiles p set status = p_status where p.id = p_member_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'The status was not saved.' using errcode = 'P0002';
  end if;

  insert into public.member_status_audit (member_id, from_status, to_status, reason, actor_id)
  values (p_member_id, v_from, p_status, v_reason, auth.uid());

  return query select p_member_id, p_status;
end;
$function$;

revoke all on function public.set_member_status(uuid, text, text) from public, anon;
grant execute on function public.set_member_status(uuid, text, text) to authenticated;
