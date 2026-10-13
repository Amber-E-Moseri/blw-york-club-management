-- 085_saved_group_members_active_only.sql
--
-- Forward-only. Closes a gap found in the saved-group grant review.
--
-- 079 requires every member of a saved group to be an active profile, but only inside create_saved_group(). The app
-- also adds members with a direct INSERT into saved_group_members (granted to authenticated by 065; the write policy in
-- 059 lets any admin or coordinator through). A staff member could therefore add a pending or rejected account to a
-- group through the table, which 079 says must not happen.
--
-- This adds a BEFORE INSERT trigger on saved_group_members that applies the same rule. It does not change any grant or
-- policy, so the grants that the app relies on are unchanged. Audience resolution already skips inactive members, so
-- this closes the stored state, not an open audience.
--
-- The trigger function is SECURITY DEFINER with a pinned search_path, so the check reads profiles.status regardless of
-- the caller's row visibility. Nothing can execute it directly.
--
-- Dependencies: 059 (saved_group_members and its policy), 065 (grants), 079 (the rule being enforced on the table).

create or replace function public.saved_group_members_require_active()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not exists (select 1 from public.profiles p where p.id = new.profile_id and p.status = 'active') then
    raise exception 'Every member of a saved group must be an active profile.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

revoke all on function public.saved_group_members_require_active() from public, anon, authenticated, service_role;

drop trigger if exists saved_group_members_require_active on public.saved_group_members;
create trigger saved_group_members_require_active
  before insert on public.saved_group_members
  for each row execute function public.saved_group_members_require_active();
