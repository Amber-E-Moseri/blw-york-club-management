-- 080_member_status_authority.sql
--
-- Forward-only. One explicit, auditable way to change a member's account status.
--
-- The problem: 022 lets admins and coordinators change profiles.status (its guard checks is_admin_or_coordinator()),
-- but profile UPDATE RLS (022, profiles_coordinator_administer) allows only coordinators to write other people's rows.
-- An admin's direct status update therefore matched zero rows and reported nothing.
--
-- The fix keeps RLS unchanged and adds one authorised path: set_member_status(). It is SECURITY DEFINER, so it
-- writes the row on behalf of the caller only after its own checks:
--   * the caller is an active admin or coordinator (is_admin_or_coordinator),
--   * the caller is not changing their own status,
--   * the status is one of pending, active, inactive, rejected,
--   * a reason is given (it is written to the audit),
--   * a pending account is not activated here: activation goes through approve_pending_member, which also sends
--     the approval email,
--   * the target exists and its status really changes (no-op requests are refused, not reported as saved),
--   * exactly one row is written, and the audit row is written in the same transaction.
-- Nothing else is granted: direct UPDATE on profiles is still coordinator-only.
--
-- Dependencies: 016 and 022 (profile guards, approve_pending_member), 028 (staff edit audit).

create table if not exists public.member_status_audit (
  id           bigint generated always as identity primary key,
  member_id    uuid        not null,
  from_status  text        not null,
  to_status    text        not null check (to_status in ('pending', 'active', 'inactive', 'rejected')),
  reason       text        not null,
  actor_id     uuid,
  changed_at   timestamptz not null default now()
);

create index if not exists member_status_audit_member_idx on public.member_status_audit (member_id, changed_at desc);

alter table public.member_status_audit enable row level security;

drop policy if exists member_status_audit_read on public.member_status_audit;
create policy member_status_audit_read on public.member_status_audit
  for select using (public.is_admin_or_coordinator());

revoke all on table public.member_status_audit from anon, authenticated;
grant select on table public.member_status_audit to authenticated;
grant select, insert, update, delete on table public.member_status_audit to service_role;

create or replace function public.set_member_status(p_member_id uuid, p_status text, p_reason text default null)
returns table (member_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_from   text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_rows   int;
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

  select p.status into v_from from public.profiles p where p.id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  if v_from = p_status then
    raise exception 'The member already has that status.' using errcode = 'P0001';
  end if;
  if v_from = 'pending' and p_status = 'active' then
    raise exception 'Activate a pending member through the approval page, which also sends the approval email.'
      using errcode = 'P0001';
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
