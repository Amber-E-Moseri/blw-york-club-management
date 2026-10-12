-- confession_app_compat_test.sql
--
-- Compatibility between migration 045 and src/lib/queries/confessions.ts. Runs the same statements the app issues:
--   fetchConfessionsForDate / fetchUpcomingConfessions  -> rpc confession_declaration_counts + own-row select
--   declareConfession   -> upsert on confession_declarations (INSERT ... ON CONFLICT DO UPDATE)
--   undeclareConfession -> delete on confession_declarations matched by confession_id and user_id
-- Real schema, no stand-ins, rolled back.

begin;
set local session_replication_role = replica;

create schema compat_test;
grant usage on schema compat_test to authenticated, anon;
create table compat_test.results (name text, ok boolean, detail text);

insert into public.profiles (id, email, full_name, role, status) values
  ('00000000-0000-0000-0000-00000000e001', 'act@t',  'Active member',  'member', 'active'),
  ('00000000-0000-0000-0000-00000000e002', 'act2@t', 'Active member 2', 'member', 'active'),
  ('00000000-0000-0000-0000-00000000e003', 'pen@t',  'Pending member', 'member', 'pending');
insert into public.confessions (id, title, body, scheduled_date, created_by, is_active) values
  ('e5000000-0000-0000-0000-0000000000e1', 'Confession', 'text', current_date, '00000000-0000-0000-0000-00000000e001', true);
insert into public.confession_declarations (confession_id, user_id) values
  ('e5000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e002');

create function compat_test.as_user(p_user uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute 'set local role authenticated';
end $fn$;

create function compat_test.as_owner() returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $fn$;

create function compat_test.check(p_name text, p_user uuid, p_sql text, p_expected bigint) returns void language plpgsql as $fn$
declare n bigint;
begin
  perform compat_test.as_user(p_user);
  execute 'select count(*) from (' || p_sql || ') q' into n;
  perform compat_test.as_owner();
  insert into compat_test.results values (p_name, n = p_expected, n || ' (expected ' || p_expected || ')');
end $fn$;

create function compat_test.run_ok(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $fn$
declare got text := 'ok';
begin
  perform compat_test.as_user(p_user);
  begin
    execute p_sql;
  exception when others then
    got := sqlstate || ' ' || sqlerrm;
  end;
  perform compat_test.as_owner();
  insert into compat_test.results values (p_name, got = 'ok', got);
end $fn$;

create function compat_test.run_denied(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $fn$
declare got text := 'allowed';
begin
  perform compat_test.as_user(p_user);
  begin
    execute p_sql;
  exception when others then
    got := sqlstate;
  end;
  perform compat_test.as_owner();
  insert into compat_test.results values (p_name, got = '42501', 'got ' || got || ' (expected 42501 denied)');
end $fn$;

-- Active member (e001): the app's count and own-status path
select compat_test.check('C1 active member: count RPC returns the confession (aggregate)', '00000000-0000-0000-0000-00000000e001',
  $q$select confession_id from public.confession_declaration_counts(array['e5000000-0000-0000-0000-0000000000e1'::uuid])$q$, 1);
select compat_test.check('C2 active member: own-row select for declared_by_me returns nothing (not declared yet)', '00000000-0000-0000-0000-00000000e001',
  $q$select confession_id from public.confession_declarations where user_id = '00000000-0000-0000-0000-00000000e001' and confession_id in ('e5000000-0000-0000-0000-0000000000e1')$q$, 0);
select compat_test.check('C3 active member: other member row is not returned by the app query', '00000000-0000-0000-0000-00000000e001',
  $q$select confession_id from public.confession_declarations where user_id = '00000000-0000-0000-0000-00000000e002' and confession_id in ('e5000000-0000-0000-0000-0000000000e1')$q$, 0);

-- Active member declares, then the count and own status update, then undeclares
select compat_test.run_ok('C4 active member: declareConfession upsert succeeds', '00000000-0000-0000-0000-00000000e001',
  $q$insert into public.confession_declarations (confession_id, user_id) values ('e5000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e001') on conflict (confession_id, user_id) do update set created_at = now()$q$);
select compat_test.check('C5 active member: own declared status is visible after declaring', '00000000-0000-0000-0000-00000000e001',
  $q$select confession_id from public.confession_declarations where user_id = '00000000-0000-0000-0000-00000000e001' and confession_id in ('e5000000-0000-0000-0000-0000000000e1')$q$, 1);
select compat_test.check('C6 active member: count RPC now counts two active declarations', '00000000-0000-0000-0000-00000000e001',
  $q$select 1 from public.confession_declaration_counts(array['e5000000-0000-0000-0000-0000000000e1'::uuid]) where declaration_count = 2$q$, 1);
select compat_test.run_ok('C7 active member: undeclareConfession delete succeeds', '00000000-0000-0000-0000-00000000e001',
  $q$delete from public.confession_declarations where confession_id = 'e5000000-0000-0000-0000-0000000000e1' and user_id = '00000000-0000-0000-0000-00000000e001'$q$);

-- Pending member (e003): the app's path returns zero, not an error, and writes are refused
select compat_test.check('C8 pending member: count RPC returns no rows (no error for the app)', '00000000-0000-0000-0000-00000000e003',
  $q$select confession_id from public.confession_declaration_counts(array['e5000000-0000-0000-0000-0000000000e1'::uuid])$q$, 0);
select compat_test.check('C9 pending member: own declared status returns nothing (T1)', '00000000-0000-0000-0000-00000000e003',
  $q$select confession_id from public.confession_declarations where user_id = '00000000-0000-0000-0000-00000000e003'$q$, 0);
select compat_test.run_denied('C10 pending member: declareConfession is refused', '00000000-0000-0000-0000-00000000e003',
  $q$insert into public.confession_declarations (confession_id, user_id) values ('e5000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e003')$q$);

select * from compat_test.results order by name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from compat_test.results;

rollback;
