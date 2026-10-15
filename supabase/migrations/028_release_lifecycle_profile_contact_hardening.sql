-- 028_release_lifecycle_profile_contact_hardening.sql
--
-- Final local release hardening:
--   * add the inactive account state to profiles without changing old migrations;
--   * allow pending accounts to edit only ordinary onboarding fields;
--   * audit staff profile edits without storing phone-number values;
--   * allow repeated outreach interactions while deduplicating network retries by idempotency key.

alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
    check (status in ('pending', 'active', 'inactive', 'rejected'));

create table if not exists public.staff_profile_edit_audit (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  source_table text not null check (source_table in ('profiles', 'user_profiles')),
  changed_fields text[] not null,
  redacted_changes jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists staff_profile_edit_audit_target_idx on public.staff_profile_edit_audit (target_user_id, changed_at desc);
create index if not exists staff_profile_edit_audit_actor_idx on public.staff_profile_edit_audit (changed_by, changed_at desc);

alter table public.staff_profile_edit_audit enable row level security;

drop policy if exists staff_profile_edit_audit_admin_read on public.staff_profile_edit_audit;
create policy staff_profile_edit_audit_admin_read on public.staff_profile_edit_audit
  for select to authenticated
  using (public.is_admin_or_coordinator());

create or replace function public.profile_edit_changed_fields(old_row jsonb, new_row jsonb, allowed_keys text[])
returns text[]
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(key order by key), '{}'::text[])
  from unnest(allowed_keys) as key
  where old_row -> key is distinct from new_row -> key
$$;

create or replace function public.redacted_profile_changes(old_row jsonb, new_row jsonb, changed text[])
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  result jsonb := '{}'::jsonb;
  field text;
begin
  foreach field in array changed loop
    result := result || jsonb_build_object(
      field,
      jsonb_build_object(
        'old', case when field = 'phone' then to_jsonb('[redacted]'::text) else old_row -> field end,
        'new', case when field = 'phone' then to_jsonb('[redacted]'::text) else new_row -> field end
      )
    );
  end loop;
  return result;
end;
$$;

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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
$$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

drop policy if exists profiles_self_onboarding_update on public.profiles;
create policy profiles_self_onboarding_update on public.profiles
  for update to authenticated
  using (id = auth.uid() and status = 'pending')
  with check (id = auth.uid() and status = 'pending');

drop policy if exists profiles_insert on public.user_profiles;
create policy profiles_insert on public.user_profiles
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status in ('pending', 'active')
    )
  );

drop policy if exists profiles_update on public.user_profiles;
create policy profiles_update on public.user_profiles
  for update to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status in ('pending', 'active')
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status in ('pending', 'active')
    )
  );

drop policy if exists profiles_delete on public.user_profiles;
create policy profiles_delete on public.user_profiles
  for delete to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
    )
  );

drop policy if exists user_profiles_staff_insert on public.user_profiles;
create policy user_profiles_staff_insert on public.user_profiles
  for insert to authenticated
  with check (public.is_admin_or_coordinator());

drop policy if exists user_profiles_staff_update on public.user_profiles;
create policy user_profiles_staff_update on public.user_profiles
  for update to authenticated
  using (public.is_admin_or_coordinator())
  with check (public.is_admin_or_coordinator());

create or replace function public.audit_staff_profile_edits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target uuid;
  changed text[];
begin
  if actor is null then
    return new;
  end if;

  if tg_table_name = 'profiles' then
    target := new.id;
  else
    target := new.user_id;
  end if;
  if actor = target then
    return new;
  end if;

  if not public.is_admin_or_coordinator() then
    return new;
  end if;

  if tg_table_name = 'profiles' then
    changed := public.profile_edit_changed_fields(
      to_jsonb(old), to_jsonb(new), array['full_name', 'avatar_url', 'student_number']
    );
  else
    changed := public.profile_edit_changed_fields(
      to_jsonb(old), to_jsonb(new), array['first_name', 'last_name', 'phone', 'avatar_url', 'bio', 'student_number']
    );
  end if;

  if coalesce(array_length(changed, 1), 0) = 0 then
    return new;
  end if;

  insert into public.staff_profile_edit_audit (
    target_user_id,
    changed_by,
    source_table,
    changed_fields,
    redacted_changes
  )
  values (
    target,
    actor,
    tg_table_name,
    changed,
    public.redacted_profile_changes(to_jsonb(old), to_jsonb(new), changed)
  );

  return new;
end;
$$;

drop trigger if exists profiles_staff_edit_audit on public.profiles;
create trigger profiles_staff_edit_audit
  after update on public.profiles
  for each row execute function public.audit_staff_profile_edits();

drop trigger if exists user_profiles_staff_edit_audit on public.user_profiles;
create trigger user_profiles_staff_edit_audit
  after update on public.user_profiles
  for each row execute function public.audit_staff_profile_edits();

alter table public.contacts
  add column if not exists idempotency_key text;

create unique index if not exists contacts_logged_by_idempotency_key_unique
  on public.contacts (logged_by, idempotency_key)
  where idempotency_key is not null;

grant select on table public.staff_profile_edit_audit to authenticated;
grant select, insert, update, delete on table public.staff_profile_edit_audit to service_role;
revoke all on function public.profile_edit_changed_fields(jsonb, jsonb, text[]) from public, anon;
revoke all on function public.redacted_profile_changes(jsonb, jsonb, text[]) from public, anon;
revoke all on function public.audit_staff_profile_edits() from public, anon, authenticated, service_role;
grant execute on function public.profile_edit_changed_fields(jsonb, jsonb, text[]) to authenticated, service_role;
grant execute on function public.redacted_profile_changes(jsonb, jsonb, text[]) to authenticated, service_role;
