-- 062_profile_field_sync.sql
-- Keeps the two existing profile editing paths consistent. Forward-only. No new editing mechanism.
--
-- student_number and avatar_url are stored in both public.profiles (edited through profiles_self_onboarding_update,
-- migration 045) and public.user_profiles (edited through its own policies). The application writes both in one save,
-- but a direct API call to one path could leave the other stale. These triggers mirror the two shared columns between the
-- two rows for the same account. A mirror writes only when the value differs, so the triggers cannot loop.
--
-- Protected attributes are not synchronised and are not writable through either path: role, status, admin_role, cell_id,
-- person_id and bsc_id remain guarded by guard_profile_privileged_columns (migration 028) and by the user_profiles policies.
-- The mirror functions run as the table owner so they can update the other row; they only copy two columns and only for
-- the same account (user_profiles.user_id = profiles.id).

create or replace function public._mirror_profile_to_user_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.student_number is distinct from old.student_number or new.avatar_url is distinct from old.avatar_url then
    update public.user_profiles up
       set student_number = new.student_number,
           avatar_url = new.avatar_url
     where up.user_id = new.id
       and (up.student_number is distinct from new.student_number or up.avatar_url is distinct from new.avatar_url);
  end if;
  return new;
end;
$$;

create or replace function public._mirror_user_profile_to_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.student_number is distinct from old.student_number or new.avatar_url is distinct from old.avatar_url then
    update public.profiles p
       set student_number = new.student_number,
           avatar_url = new.avatar_url
     where p.id = new.user_id
       and (p.student_number is distinct from new.student_number or p.avatar_url is distinct from new.avatar_url);
  end if;
  return new;
end;
$$;

revoke all on function public._mirror_profile_to_user_profiles() from public, anon, authenticated;
revoke all on function public._mirror_user_profile_to_profiles() from public, anon, authenticated;

drop trigger if exists profiles_mirror_shared_fields on public.profiles;
create trigger profiles_mirror_shared_fields
  after update of student_number, avatar_url on public.profiles
  for each row execute function public._mirror_profile_to_user_profiles();

drop trigger if exists user_profiles_mirror_shared_fields on public.user_profiles;
create trigger user_profiles_mirror_shared_fields
  after update of student_number, avatar_url on public.user_profiles
  for each row execute function public._mirror_user_profile_to_profiles();
