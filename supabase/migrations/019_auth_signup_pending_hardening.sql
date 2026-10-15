-- Ensure new Auth signups enter the approval workflow and cannot smuggle
-- privileged membership fields through raw user metadata.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_name text := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1));
  linked_person_id uuid;
begin
  select id
    into linked_person_id
  from public.people
  where public.normalize_identity_email(email) = public.normalize_identity_email(new.email)
  limit 1;

  if linked_person_id is null then
    insert into public.people (full_name, email)
    values (profile_name, new.email)
    returning id into linked_person_id;
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    status,
    student_number,
    avatar_url,
    joined_at,
    person_id
  )
  values (
    new.id,
    new.email,
    profile_name,
    'member',
    'pending',
    new.raw_user_meta_data->>'student_number',
    new.raw_user_meta_data->>'avatar_url',
    new.created_at,
    linked_person_id
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name),
    student_number = coalesce(excluded.student_number, profiles.student_number),
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
    person_id = coalesce(profiles.person_id, excluded.person_id),
    updated_at = now();

  return new;
end;
$$;
