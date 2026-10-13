-- 079_saved_group_active_members.sql
--
-- Forward-only correction to create_saved_group (076). Stricter rules from the consolidated candidate.
--
--   * Every member must be an active profile. 076 accepted any profile, so a pending or rejected account could be
--     placed in a saved group. Audience resolution filters inactive members, but the group itself should not hold them.
--   * The group name is 1 to 120 characters after trimming.
--   * Still SECURITY INVOKER, so the caller's row-level security on saved_groups and saved_group_members applies.
--     Only admins and coordinators pass the first check.
--
-- Replaces the function in place. The grants made by 076 are unchanged.

create or replace function public.create_saved_group(p_name text, p_member_ids uuid[] default '{}')
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_group uuid;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Saved groups are managed by coordinators and admins.' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'Group name must be 1 to 120 characters.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_member_ids), 0) = 0 then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_member_ids) as m(id)
    where not exists (select 1 from public.profiles p where p.id = m.id and p.status = 'active')
  ) then
    raise exception 'Every member of a saved group must be an active profile.' using errcode = '22023';
  end if;

  insert into public.saved_groups (name, created_by, is_active)
  values (v_name, auth.uid(), true)
  returning id into v_group;

  insert into public.saved_group_members (group_id, profile_id, added_by)
  select v_group, m.id, auth.uid()
  from (select distinct unnest(p_member_ids) as id) m
  on conflict (group_id, profile_id) do nothing;

  return v_group;
end;
$function$;

revoke all on function public.create_saved_group(text, uuid[]) from public, anon;
grant execute on function public.create_saved_group(text, uuid[]) to authenticated;
