-- 022_profile_authorization_hardening.sql
--
-- Makes profile authorization explicit, certifiable and drift-proof, and adds a one-time, auditable way to
-- create the first administrator on a clean project.
--
-- Background. Migration 016 replaced the profile policies it knew by name, but a database that was ever touched
-- by hand-run SQL can carry arbitrary extra policies (a previous prototype had profiles_self_update, which let any
-- signed-in user rewrite their own role/status/admin_role). Dropping policies by remembered name cannot protect
-- against drift, so this migration drops by ALLOW-LIST: on profiles and user_profiles, every policy that is not
-- listed below is removed, and the listed ones are (re)created from the definitions below.
--
-- Approval enforced by the database. Until now the "pending approval" state was only a screen in the UI: 22
-- policies let ANY signed-in account (including pending and rejected ones) read or write, for example the whole
-- People directory with contact names, emails and phone numbers. Section 3 introduces is_active_member(), makes
-- every authorization helper require an active account, and rewrites each such policy to require it.
--
-- Defence in depth. Even if a future policy were mistakenly added, a trigger refuses any change to
-- role / status / admin_role from a normal signed-in user:
--   * role and admin_role may be changed only by a coordinator (or the backend / database owner),
--   * status may be changed only by an admin or coordinator (or the backend / database owner).
-- The approve/reject RPCs run as the function owner, so they pass the guard after their own authorization check.

-- ---------------------------------------------------------------------------
-- 1. Policy allow-list
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname not in ('profiles_select_scoped', 'profiles_coordinator_administer')
  loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;

  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_profiles'
      and policyname not in ('profiles_delete', 'profiles_insert', 'profiles_update', 'user_profiles_select_scoped')
  loop
    execute format('drop policy %I on public.user_profiles', p.policyname);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.user_profiles enable row level security;

drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles
  for select
  using (id = auth.uid() or public.is_admin_or_coordinator() or public.is_cell_leader_for_profile(id));

drop policy if exists profiles_coordinator_administer on public.profiles;
create policy profiles_coordinator_administer on public.profiles
  for all
  using (public.is_coordinator())
  with check (public.is_coordinator());

drop policy if exists profiles_delete on public.user_profiles;
create policy profiles_delete on public.user_profiles
  for delete using (auth.uid() = user_id);

drop policy if exists profiles_insert on public.user_profiles;
create policy profiles_insert on public.user_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists profiles_update on public.user_profiles;
create policy profiles_update on public.user_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_profiles_select_scoped on public.user_profiles;
create policy user_profiles_select_scoped on public.user_profiles
  for select
  using (user_id = auth.uid() or public.is_admin_or_coordinator() or public.is_cell_leader_for_profile(user_id));

-- ---------------------------------------------------------------------------
-- 2. Privileged-column guard
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Backend and database-owner contexts (service_role, migrations, SQL editor). Because this function is SECURITY
  -- INVOKER, current_user is the role that issued the statement; inside a SECURITY DEFINER RPC it is the function
  -- owner, so the approve/reject RPCs pass after their own authorization check.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.role is distinct from old.role or new.admin_role is distinct from old.admin_role then
    if not public.is_coordinator() then
      raise exception 'Not authorised to change role or admin_role.' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not public.is_admin_or_coordinator() then
      raise exception 'Not authorised to change account status.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

-- ---------------------------------------------------------------------------
-- 3. Approval is enforced by the database
-- ---------------------------------------------------------------------------
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;

-- Every helper now answers "no" for an account that is not active (pending or rejected). A rejected coordinator
-- therefore loses administrative power immediately.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_core_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role in ('admin', 'coordinator')
  )
$$;

create or replace function public.is_cell_leader_for_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles actor
    join public.profiles target on target.id = target_user_id
    where actor.id = auth.uid()
      and actor.status = 'active'
      and actor.role = 'cell_leader'
      and actor.cell_id is not null
      and actor.cell_id = target.cell_id
  )
$$;

create or replace function public.is_cell_leader_of(p_cell_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_cell_id is null then false
    else public.is_active_member() and exists (
      select 1 from public.cells where id = p_cell_id and leader_id = auth.uid()
    )
  end
$$;

create or replace function public.has_admin_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin_or_coordinator()
    or (public.is_active_member() and exists (
      select 1
      from public.admin_role_assignments ara
      join public.admin_role_permissions arp on arp.role_id = ara.role_id
      where ara.user_id = auth.uid()
        and arp.permission_key = permission
    ))
$$;

-- Rewrite every policy that only checked "signed in" so that it requires an ACTIVE account. Each policy is rewritten
-- in place (same name, same command); the assertion at the end proves none was missed.
do $$
declare
  p record;
  q text;
  c text;
  needle constant text := '(auth.role() = ''authenticated''::text)';
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%' || needle || '%'
  loop
    q := case when p.qual is null then null else replace(p.qual, needle, 'public.is_active_member()') end;
    c := case when p.with_check is null then null else replace(p.with_check, needle, 'public.is_active_member()') end;
    if q is not null and c is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)', p.policyname, p.schemaname, p.tablename, q, c);
    elsif q is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, q);
    else
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, c);
    end if;
  end loop;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) like '%' || needle || '%'
  ) then
    raise exception '022: a policy still authorises any signed-in account without requiring an active one';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. One-time first-administrator bootstrap
-- ---------------------------------------------------------------------------
-- A clean project has no administrator, and public signup can only ever create member + pending accounts. The first
-- administrator is therefore created by an EXPLICIT action run by the database owner:
--
--     select public.bootstrap_first_administrator('owner@example.org', 'initial coordinator');
--
-- It creates no account and sets no password: the person signs up normally first (and confirms their email).
-- It then promotes that existing account to coordinator + active, makes sure the People state is correct
-- (person, active membership, transition record), and writes an audit row. It works exactly once: it refuses if any
-- audit row exists or an active admin/coordinator already exists. After use it can be removed entirely:
--     drop function public.bootstrap_first_administrator(text, text);
-- It is not executable by anon, authenticated or service_role.
create table if not exists public.admin_bootstrap_audit (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references public.profiles(id) on delete set null,
  performed_by text not null,
  performed_at timestamptz not null default now(),
  note text
);
alter table public.admin_bootstrap_audit enable row level security;
-- No policies and no API grants: this table is reachable only by the database owner.

create or replace function public.bootstrap_first_administrator(target_email text, note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_status text;
  v_person uuid;
  v_name text;
begin
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception 'bootstrap_first_administrator can only be run by the database owner.' using errcode = '42501';
  end if;
  if exists (select 1 from public.admin_bootstrap_audit) then
    raise exception 'Bootstrap already completed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where role in ('admin', 'coordinator') and status = 'active') then
    raise exception 'An active administrator already exists; bootstrap is not allowed.' using errcode = 'P0001';
  end if;

  select p.id, p.status, p.person_id, p.full_name
    into v_user, v_status, v_person, v_name
  from public.profiles p
  where lower(p.email) = lower(trim(target_email));
  if v_user is null then
    raise exception 'No signed-up account with that email. The person must sign up first.' using errcode = 'P0002';
  end if;
  if v_status = 'rejected' then
    raise exception 'That account was rejected and cannot be bootstrapped.' using errcode = 'P0001';
  end if;

  if v_person is null then
    insert into public.people (full_name, email)
    values (coalesce(nullif(v_name, ''), split_part(lower(trim(target_email)), '@', 1)), lower(trim(target_email)))
    returning id into v_person;
    update public.profiles set person_id = v_person where id = v_user;
  end if;

  update public.profiles set role = 'coordinator', status = 'active' where id = v_user;

  if exists (select 1 from public.memberships where person_id = v_person and status = 'active') then
    update public.memberships set role = 'coordinator' where person_id = v_person and status = 'active';
  else
    update public.memberships set status = 'inactive' where person_id = v_person and status = 'pending';
    insert into public.memberships (person_id, role, status) values (v_person, 'coordinator', 'active');
  end if;

  insert into public.membership_transitions (person_id, from_type, to_type, performed_by, notes)
  values (v_person, null, 'member', v_user, 'One-time first-administrator bootstrap');

  insert into public.admin_bootstrap_audit (target_user_id, performed_by, note)
  values (v_user, session_user, bootstrap_first_administrator.note);

  return v_user;
end;
$$;

revoke all on function public.bootstrap_first_administrator(text, text) from public, anon, authenticated, service_role;
