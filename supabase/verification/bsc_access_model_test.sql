-- bsc_access_model_test.sql
--
-- Behavioural test of the BSC access rules (migrations 038 and 039) on a plain Postgres 15+ server.
--
-- It creates a minimal stand-in for the Supabase pieces the migrations rely on (auth.uid(), auth.role(), the
-- authenticated role, and the helper functions from earlier migrations), then runs the REAL migration files with
-- \i, then checks what each user can see and change. Everything runs in one transaction that is rolled back, so
-- the database is left unchanged.
--
-- Run from the repository root:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verification/bsc_access_model_test.sql
--
-- This checks the rules as written. It does not replay the full migration history, so also run the SQL Editor
-- checks (bsc_access_checks.sql) against the real project.

\set QUIET 1
begin;

-- ─── Stand-ins for Supabase and earlier migrations ───────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key);

create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select 'authenticated'::text $$;

create table public.profiles (
  id        uuid primary key references auth.users(id),
  email     text,
  full_name text,
  role      text not null default 'member',
  status    text not null default 'active',
  cell_id   uuid
);
alter table public.profiles enable row level security;

create table public.cells (
  id        uuid primary key,
  name      text not null,
  leader_id uuid references public.profiles(id)
);

create table public.monthly_devotionals (id uuid primary key default gen_random_uuid());

create table public.devotional_views (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references auth.users(id),
  devotional_id uuid references public.monthly_devotionals(id),
  day_of_month  int not null,
  viewed_date   date not null
);
alter table public.devotional_views enable row level security;

create table public.confessions (id uuid primary key default gen_random_uuid());

create table public.confession_declarations (
  confession_id uuid not null references public.confessions(id),
  user_id       uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  primary key (confession_id, user_id)
);
alter table public.confession_declarations enable row level security;

create table public.habit_entries (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id)
);
alter table public.habit_entries enable row level security;

create or replace function public.is_admin_or_coordinator() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'coordinator')) $$;
create or replace function public.is_devotional_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select public.is_admin_or_coordinator() $$;
create or replace function public.is_cell_leader_of(p_cell_id uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.cells where id = p_cell_id and leader_id = auth.uid()) $$;

-- Policies as they stand after earlier migrations (only the ones the BSC rules touch).
create policy devotional_views_select_own_or_admin on public.devotional_views for select
  using (auth.uid() = member_id or public.is_devotional_admin());
create policy confession_declarations_read_own on public.confession_declarations for select
  using (auth.uid() = user_id);
create policy habit_entries_own on public.habit_entries for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habit_entries_admin_read on public.habit_entries for select
  using (auth.uid() = user_id or public.is_admin_or_coordinator());
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_admin_or_coordinator());
create policy profiles_update on public.profiles for update
  using (public.is_admin_or_coordinator() or id = auth.uid())
  with check (public.is_admin_or_coordinator() or id = auth.uid());

grant usage on schema public, auth to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated, anon;

-- ─── The real migrations under test ──────────────────────────────────────────────────────────────────────────────
\i supabase/migrations/038_bsc_hierarchy_access.sql
\i supabase/migrations/039_bsc_member_views.sql
\i supabase/migrations/040_bsc_grants.sql

-- ─── Test helpers ────────────────────────────────────────────────────────────────────────────────────────────────
create schema bsc_test;
create table bsc_test.results (name text, ok boolean, detail text);

create function bsc_test.as_user(p_user uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
end $fn$;

create function bsc_test.as_owner() returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $fn$;

create function bsc_test.expect_count(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform bsc_test.as_user(p_user);
  execute 'select count(*) from (' || p_sql || ') q' into n;
  perform bsc_test.as_owner();
  insert into bsc_test.results values (p_name, n = p_expected, n || ' (expected ' || p_expected || ')');
end $fn$;

create function bsc_test.expect_error(p_name text, p_user uuid, p_sql text, p_error_code text) returns void language plpgsql as $fn$
declare got text := 'no error';
begin
  perform bsc_test.as_user(p_user);
  begin
    execute p_sql;
  exception when others then
    got := sqlstate;
  end;
  perform bsc_test.as_owner();
  insert into bsc_test.results values (p_name, got = p_error_code, 'got ' || got || ' (expected ' || p_error_code || ')');
end $fn$;

create function bsc_test.expect_ok(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $fn$
declare got text := 'ok';
begin
  perform bsc_test.as_user(p_user);
  begin
    execute p_sql;
  exception when others then
    got := sqlstate || ' ' || sqlerrm;
  end;
  perform bsc_test.as_owner();
  insert into bsc_test.results values (p_name, got = 'ok', got);
end $fn$;

grant usage on schema bsc_test to authenticated, anon;
grant execute on all functions in schema bsc_test to authenticated, anon;

-- ─── Fixture (written as the database owner, so RLS does not apply while setting up) ─────────────────────────────
-- Users: coordinator c001 | admin a001 | cell A leader ca01 | cell B leader cb01 | BSC A1 leader ba01
-- Members: A1 = 01a1, A2 = 02a2, B1 = 01b1, no BSC = 00f0
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-00000000ca01'),
  ('00000000-0000-0000-0000-00000000cb01'),
  ('00000000-0000-0000-0000-00000000ba01'),
  ('00000000-0000-0000-0000-0000000001a1'),
  ('00000000-0000-0000-0000-0000000002a2'),
  ('00000000-0000-0000-0000-0000000001b1'),
  ('00000000-0000-0000-0000-0000000000f0');

insert into public.profiles (id, email, full_name, role, status) values
  ('00000000-0000-0000-0000-00000000c001', 'coord@test', 'Coordinator', 'coordinator', 'active'),
  ('00000000-0000-0000-0000-00000000a001', 'admin@test', 'Admin', 'admin', 'active'),
  ('00000000-0000-0000-0000-00000000ca01', 'cella@test', 'Cell A leader', 'cell_leader', 'active'),
  ('00000000-0000-0000-0000-00000000cb01', 'cellb@test', 'Cell B leader', 'cell_leader', 'active'),
  ('00000000-0000-0000-0000-00000000ba01', 'bsca1@test', 'BSC A1 leader', 'member', 'active'),
  ('00000000-0000-0000-0000-0000000001a1', 'a1@test', 'Member A1', 'member', 'active'),
  ('00000000-0000-0000-0000-0000000002a2', 'a2@test', 'Member A2', 'member', 'active'),
  ('00000000-0000-0000-0000-0000000001b1', 'b1@test', 'Member B1', 'member', 'active'),
  ('00000000-0000-0000-0000-0000000000f0', 'none@test', 'No BSC', 'member', 'active');

-- Cell A (led by ca01) has BSC A1 (led by ba01) and BSC A2 (no leader). Cell B (led by cb01) has BSC B1.
insert into public.cells (id, name, leader_id) values
  ('00000000-0000-0000-0000-0000000000ca', 'Cell A', '00000000-0000-0000-0000-00000000ca01'),
  ('00000000-0000-0000-0000-0000000000cb', 'Cell B', '00000000-0000-0000-0000-00000000cb01');

insert into public.bscs (id, cell_id, name, leader_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000ca', 'BSC A1', '00000000-0000-0000-0000-00000000ba01'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000ca', 'BSC A2', null),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000cb', 'BSC B1', null);

update public.profiles set bsc_id = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000001a1';
update public.profiles set bsc_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-0000000002a2';
update public.profiles set bsc_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000001b1';

-- One Rhapsody read per member
insert into public.devotional_views (member_id, day_of_month, viewed_date) values
  ('00000000-0000-0000-0000-0000000001a1', 11, current_date),
  ('00000000-0000-0000-0000-0000000002a2', 11, current_date),
  ('00000000-0000-0000-0000-0000000001b1', 11, current_date);

-- One confession declared by each assigned member
insert into public.confessions (id) values ('00000000-0000-0000-0000-00000000c0ff');
insert into public.confession_declarations (confession_id, user_id) values
  ('00000000-0000-0000-0000-00000000c0ff', '00000000-0000-0000-0000-0000000001a1'),
  ('00000000-0000-0000-0000-00000000c0ff', '00000000-0000-0000-0000-0000000002a2'),
  ('00000000-0000-0000-0000-00000000c0ff', '00000000-0000-0000-0000-0000000001b1');

-- One habit entry for member A1
insert into public.habit_entries (user_id) values ('00000000-0000-0000-0000-0000000001a1');

-- ─── Checks ──────────────────────────────────────────────────────────────────────────────────────────────────────
do $checks$
declare
  coord uuid := '00000000-0000-0000-0000-00000000c001';
  admin uuid := '00000000-0000-0000-0000-00000000a001';
  cella uuid := '00000000-0000-0000-0000-00000000ca01';
  cellb uuid := '00000000-0000-0000-0000-00000000cb01';
  bsca1 uuid := '00000000-0000-0000-0000-00000000ba01';
  a1 uuid := '00000000-0000-0000-0000-0000000001a1';
  a2 uuid := '00000000-0000-0000-0000-0000000002a2';
  nobsc uuid := '00000000-0000-0000-0000-0000000000f0';
  rhapsody text := 'select * from public.devotional_views';
  confessions text := 'select * from public.confession_declarations';
  habits text := 'select * from public.habit_entries';
  members text := 'select * from public.bsc_members_visible()';
begin
  -- Rhapsody reads
  perform bsc_test.expect_count('Rhapsody: coordinator sees all reads', coord, rhapsody, 3);
  perform bsc_test.expect_count('Rhapsody: admin sees all reads', admin, rhapsody, 3);
  perform bsc_test.expect_count('Rhapsody: BSC A1 leader sees only A1 member', bsca1, rhapsody, 1);
  perform bsc_test.expect_count('Rhapsody: cell A leader sees A1 and A2, not B1', cella, rhapsody, 2);
  perform bsc_test.expect_count('Rhapsody: cell B leader sees only B1', cellb, rhapsody, 1);
  perform bsc_test.expect_count('Rhapsody: member A1 sees only own read', a1, rhapsody, 1);
  perform bsc_test.expect_count('Rhapsody: member A2 sees only own read', a2, rhapsody, 1);
  perform bsc_test.expect_count('Rhapsody: member with no BSC sees nothing extra', nobsc, rhapsody, 0);

  -- Confessions
  perform bsc_test.expect_count('Confessions: coordinator sees all', coord, confessions, 3);
  perform bsc_test.expect_count('Confessions: BSC A1 leader sees only A1', bsca1, confessions, 1);
  perform bsc_test.expect_count('Confessions: cell A leader sees A1 and A2', cella, confessions, 2);
  perform bsc_test.expect_count('Confessions: cell B leader sees only B1', cellb, confessions, 1);
  perform bsc_test.expect_count('Confessions: member A1 sees own only', a1, confessions, 1);

  -- Habits stay private to the member, coordinator and admin
  perform bsc_test.expect_count('Habits: coordinator sees all', coord, habits, 1);
  perform bsc_test.expect_count('Habits: BSC A1 leader sees none', bsca1, habits, 0);
  perform bsc_test.expect_count('Habits: cell A leader sees none', cella, habits, 0);
  perform bsc_test.expect_count('Habits: member A1 sees own', a1, habits, 1);

  -- Member list
  perform bsc_test.expect_count('Member list: coordinator sees all assigned', coord, members, 3);
  perform bsc_test.expect_count('Member list: BSC A1 leader sees only A1', bsca1, members, 1);
  perform bsc_test.expect_count('Member list: cell A leader sees A1 and A2', cella, members, 2);
  perform bsc_test.expect_count('Member list: member A1 sees no peers', a1, members, 0);

  -- Assignment: only coordinators and admins
  perform bsc_test.expect_error('Assignment: member cannot move self', a1,
    $q$update public.profiles set bsc_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000001a1'$q$, '42501');
  -- Row-level security hides the member from the cell leader, so the update matches no rows and changes nothing.
  perform bsc_test.expect_ok('Assignment: cell leader update is accepted but matches no member', cella,
    $q$update public.profiles set bsc_id = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000000f0'$q$);
  insert into bsc_test.results
    select 'Assignment: member with no BSC is still unassigned after cell leader attempt',
           (select bsc_id is null from public.profiles where id = '00000000-0000-0000-0000-0000000000f0'),
           'checked as the database owner';
  perform bsc_test.expect_ok('Assignment: coordinator can assign a member with no BSC', coord,
    $q$update public.profiles set bsc_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-0000000000f0'$q$);
  perform bsc_test.expect_ok('Assignment: admin can move a member', admin,
    $q$update public.profiles set bsc_id = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000000f0'$q$);

  -- BSC management: a cell leader creates BSCs only in their own cell
  perform bsc_test.expect_ok('BSCs: cell A leader can create a BSC in cell A', cella,
    $q$insert into public.bscs (cell_id, name) values ('00000000-0000-0000-0000-0000000000ca', 'BSC A3')$q$);
  perform bsc_test.expect_error('BSCs: cell A leader cannot create a BSC in cell B', cella,
    $q$insert into public.bscs (cell_id, name) values ('00000000-0000-0000-0000-0000000000cb', 'BSC B2')$q$, '42501');
end
$checks$;

-- ─── Report ──────────────────────────────────────────────────────────────────────────────────────────────────────
select case when ok then 'PASS' else 'FAIL' end as result, name, detail
from bsc_test.results
order by ok, name;

select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed
from bsc_test.results;

rollback;
