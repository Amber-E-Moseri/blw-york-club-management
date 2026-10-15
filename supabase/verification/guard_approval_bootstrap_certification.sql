-- guard_approval_bootstrap_certification.sql
-- Fake local identities only; everything is rolled back. Run:
--   docker exec -i supabase_db_<project> psql -U postgres -v ON_ERROR_STOP=1 < guard_approval_bootstrap_certification.sql
--
-- Proves, at the database level:
--   * DEFENCE IN DEPTH: even with a deliberately permissive rogue UPDATE policy on profiles (the kind of drift that
--     hit the old prototype), a normal signed-in user still cannot change role / status / admin_role;
--   * APPROVAL IS ENFORCED BY THE DATABASE: pending and rejected accounts are denied reads and writes that used to
--     work for any signed-in account, and a rejected coordinator loses administrative power;
--   * the first-administrator bootstrap works once, creates the right People state, writes an audit row, and is
--     unreachable by every API role.
begin;

create temporary table cert_results (area text not null, check_name text not null, result text not null, evidence text) on commit drop;

create or replace function pg_temp.cert_pass(area text, check_name text, evidence text default null)
returns void language plpgsql security definer as $$ begin insert into cert_results values (area, check_name, 'PASS', evidence); end $$;
create or replace function pg_temp.cert_fail(area text, check_name text, evidence text)
returns void language plpgsql security definer as $$ begin insert into cert_results values (area, check_name, 'FAIL', evidence); end $$;

create or replace function pg_temp.as_auth(user_id uuid)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;

do $$
declare
  member_id uuid := '20000000-0000-0000-0000-000000000001';
  leader_id uuid := '20000000-0000-0000-0000-000000000002';
  admin_id  uuid := '20000000-0000-0000-0000-000000000003';
  coord_id  uuid := '20000000-0000-0000-0000-000000000004';
  pending_id uuid := '20000000-0000-0000-0000-000000000005';
  rejected_id uuid := '20000000-0000-0000-0000-000000000006';
  fallen_id uuid := '20000000-0000-0000-0000-000000000007';
  owner_id  uuid := '20000000-0000-0000-0000-000000000008';
  second_id uuid := '20000000-0000-0000-0000-000000000009';
  visible integer;
  observed text;
  state text;
  cert_cell uuid;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at) values
    (member_id,  'cert.guard.member@example.test',  'x', 'authenticated', 'authenticated', now(), now()),
    (leader_id,  'cert.guard.leader@example.test',  'x', 'authenticated', 'authenticated', now(), now()),
    (admin_id,   'cert.guard.admin@example.test',   'x', 'authenticated', 'authenticated', now(), now()),
    (coord_id,   'cert.guard.coord@example.test',   'x', 'authenticated', 'authenticated', now(), now()),
    (pending_id, 'cert.guard.pending@example.test', 'x', 'authenticated', 'authenticated', now(), now()),
    (rejected_id,'cert.guard.rejected@example.test','x', 'authenticated', 'authenticated', now(), now()),
    (fallen_id,  'cert.guard.fallen@example.test',  'x', 'authenticated', 'authenticated', now(), now()),
    (owner_id,   'cert.guard.owner@example.test',   'x', 'authenticated', 'authenticated', now(), now()),
    (second_id,  'cert.guard.second@example.test',  'x', 'authenticated', 'authenticated', now(), now());

  -- every signup starts as member + pending (the trigger); the database owner then sets up the roles
  update public.profiles set status = 'active' where id in (member_id, leader_id, admin_id, coord_id, fallen_id);
  update public.profiles set role = 'cell_leader' where id = leader_id;
  update public.profiles set role = 'admin' where id = admin_id;
  update public.profiles set role = 'coordinator' where id in (coord_id, fallen_id);
  update public.profiles set status = 'rejected' where id = rejected_id;

  insert into public.people (full_name, email) values ('Cert Guard Person', 'cert.guard.person@example.test');

  -- Put the cell leader, the member and the pending account in ONE cell so the leader can SEE their rows. Without
  -- this an UPDATE would touch zero rows and prove nothing about the guard.
  insert into public.cells (name, leader_id) values ('Cert Guard Cell', leader_id) returning id into cert_cell;
  update public.profiles set cell_id = cert_cell where id in (leader_id, member_id, pending_id);

  -- ===== DEFENCE IN DEPTH: a permissive rogue policy must not be enough =====================================================
  create policy cert_rogue_update on public.profiles for update to authenticated using (true) with check (true);

  perform pg_temp.as_auth(member_id);
  begin update public.profiles set role = 'coordinator' where id = member_id;
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Guard', 'member cannot promote self (rogue policy present)', 'update succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Guard', 'member cannot promote self (rogue policy present)', sqlerrm); end;

  perform pg_temp.as_auth(member_id);
  begin update public.profiles set admin_role = 'superuser' where id = member_id;
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Guard', 'member cannot set own admin_role (rogue policy present)', 'update succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Guard', 'member cannot set own admin_role (rogue policy present)', sqlerrm); end;

  perform pg_temp.as_auth(pending_id);
  begin update public.profiles set status = 'active' where id = pending_id;
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Guard', 'pending account cannot self-activate (rogue policy present)', 'update succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Guard', 'pending account cannot self-activate (rogue policy present)', sqlerrm); end;

  perform pg_temp.as_auth(rejected_id);
  begin update public.profiles set status = 'active' where id = rejected_id;
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Guard', 'rejected account cannot reactivate itself (rogue policy present)', 'update succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Guard', 'rejected account cannot reactivate itself (rogue policy present)', sqlerrm); end;

  perform pg_temp.as_auth(leader_id);
  select count(*) into visible from public.profiles where id in (member_id, pending_id);
  perform pg_temp.as_postgres();
  if visible = 2 then perform pg_temp.cert_pass('Guard', 'precondition: the cell leader can see the rows it tries to change', visible::text);
  else perform pg_temp.cert_fail('Guard', 'precondition: the cell leader can see the rows it tries to change', visible::text); end if;

  perform pg_temp.as_auth(leader_id);
  begin update public.profiles set role = 'coordinator' where id = member_id;
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Guard', 'cell leader cannot promote anyone (rogue policy present)', 'update succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Guard', 'cell leader cannot promote anyone (rogue policy present)', sqlerrm); end;

  perform pg_temp.as_auth(leader_id);
  begin update public.profiles set status = 'active' where id = pending_id;
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Guard', 'cell leader cannot approve through a direct update (rogue policy present)', 'update succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Guard', 'cell leader cannot approve through a direct update (rogue policy present)', sqlerrm); end;

  perform pg_temp.as_auth(admin_id);
  begin update public.profiles set role = 'coordinator' where id = member_id;
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Guard', 'admin cannot change a role (only a coordinator can)', 'update succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Guard', 'admin cannot change a role (only a coordinator can)', sqlerrm); end;

  perform pg_temp.as_auth(admin_id);
  update public.profiles set status = 'active' where id = pending_id;
  perform pg_temp.as_postgres();
  select status into state from public.profiles where id = pending_id;
  if state = 'active' then perform pg_temp.cert_pass('Guard', 'admin can change account status (controlled operation)', state);
  else perform pg_temp.cert_fail('Guard', 'admin can change account status (controlled operation)', state); end if;
  update public.profiles set status = 'pending' where id = pending_id;

  perform pg_temp.as_auth(coord_id);
  update public.profiles set role = 'cell_leader' where id = member_id;
  perform pg_temp.as_postgres();
  select role into state from public.profiles where id = member_id;
  if state = 'cell_leader' then perform pg_temp.cert_pass('Guard', 'coordinator can change a role (controlled operation)', state);
  else perform pg_temp.cert_fail('Guard', 'coordinator can change a role (controlled operation)', state); end if;
  update public.profiles set role = 'member' where id = member_id;

  perform pg_temp.as_auth(member_id);
  update public.profiles set full_name = 'Renamed By Policy' where id = member_id;
  perform pg_temp.as_postgres();
  select full_name into state from public.profiles where id = member_id;
  if state = 'Renamed By Policy' then perform pg_temp.cert_pass('Guard', 'the guard is column-specific: ordinary columns are unaffected', state);
  else perform pg_temp.cert_fail('Guard', 'the guard is column-specific: ordinary columns are unaffected', state); end if;

  drop policy cert_rogue_update on public.profiles;

  -- ===== APPROVAL IS ENFORCED BY THE DATABASE =========================================================================
  perform pg_temp.as_auth(member_id);
  select count(*) into visible from public.people;
  perform pg_temp.as_postgres();
  if visible >= 1 then perform pg_temp.cert_pass('Approval', 'an active member can read the people directory', visible::text);
  else perform pg_temp.cert_fail('Approval', 'an active member can read the people directory', visible::text); end if;

  perform pg_temp.as_auth(pending_id);
  select count(*) into visible from public.people;
  perform pg_temp.as_postgres();
  if visible = 0 then perform pg_temp.cert_pass('Approval', 'a pending account cannot read the people directory', visible::text);
  else perform pg_temp.cert_fail('Approval', 'a pending account cannot read the people directory', visible::text); end if;

  perform pg_temp.as_auth(rejected_id);
  select count(*) into visible from public.people;
  perform pg_temp.as_postgres();
  if visible = 0 then perform pg_temp.cert_pass('Approval', 'a rejected account cannot read the people directory', visible::text);
  else perform pg_temp.cert_fail('Approval', 'a rejected account cannot read the people directory', visible::text); end if;

  perform pg_temp.as_auth(pending_id);
  begin insert into public.people (full_name) values ('Written By Pending');
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Approval', 'a pending account cannot create people records', 'insert succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Approval', 'a pending account cannot create people records', sqlerrm); end;

  perform pg_temp.as_auth(pending_id);
  select count(*) into visible from public.profiles where id = pending_id;
  perform pg_temp.as_postgres();
  if visible = 1 then perform pg_temp.cert_pass('Approval', 'a pending account can still read its own profile (needed for the approval screen)', visible::text);
  else perform pg_temp.cert_fail('Approval', 'a pending account can still read its own profile (needed for the approval screen)', visible::text); end if;

  -- a coordinator who is later rejected loses administrative power immediately
  perform pg_temp.as_auth(fallen_id);
  select count(*) into visible from public.profiles;
  perform pg_temp.as_postgres();
  if visible > 1 then perform pg_temp.cert_pass('Approval', 'an active coordinator can see all profiles (baseline)', visible::text);
  else perform pg_temp.cert_fail('Approval', 'an active coordinator can see all profiles (baseline)', visible::text); end if;

  update public.profiles set status = 'rejected' where id = fallen_id;
  perform pg_temp.as_auth(fallen_id);
  select count(*) into visible from public.profiles;
  perform pg_temp.as_postgres();
  if visible = 1 then perform pg_temp.cert_pass('Approval', 'a rejected coordinator loses administrative power (sees only itself)', visible::text);
  else perform pg_temp.cert_fail('Approval', 'a rejected coordinator loses administrative power (sees only itself)', visible::text); end if;

  -- ===== F-1: REJECTED CELL LEADER CANNOT MANAGE ANNOUNCEMENTS ============================================================
  -- Migration 031 adds AND status = 'active' to announcements_manage.  Before the fix, any cell_leader (even
  -- status='rejected') could INSERT/UPDATE/DELETE announcements.  This block proves the fix is effective.
  update public.profiles set role = 'cell_leader' where id = rejected_id;

  -- Postgres inserts an existing announcement so UPDATE/DELETE have a target row.
  insert into public.announcements (title, body, author_id, author_name)
    values ('Cert F-1 Ann', 'cert body', coord_id, 'Cert Coord');

  -- INSERT denial: WITH CHECK violation → exception expected.
  perform pg_temp.as_auth(rejected_id);
  begin
    insert into public.announcements (title, body, author_id, author_name)
      values ('Cert Rogue Insert', 'cert body', rejected_id, 'Cert Rejected CL');
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('Announcements', 'rejected cell leader cannot insert announcement (F-1)', 'insert succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Announcements', 'rejected cell leader cannot insert announcement (F-1)', sqlerrm);
  end;

  -- UPDATE denial: USING check returns false → 0 rows touched, no exception.
  perform pg_temp.as_auth(rejected_id);
  update public.announcements set body = 'Cert Rogue Update' where title = 'Cert F-1 Ann';
  get diagnostics visible = row_count;
  perform pg_temp.as_postgres();
  if visible = 0 then perform pg_temp.cert_pass('Announcements', 'rejected cell leader update returns 0 rows (F-1)', visible::text);
  else perform pg_temp.cert_fail('Announcements', 'rejected cell leader update returns 0 rows (F-1)', visible::text); end if;

  -- DELETE denial: USING check returns false → 0 rows touched, no exception.
  perform pg_temp.as_auth(rejected_id);
  delete from public.announcements where title = 'Cert F-1 Ann';
  get diagnostics visible = row_count;
  perform pg_temp.as_postgres();
  if visible = 0 then perform pg_temp.cert_pass('Announcements', 'rejected cell leader delete returns 0 rows (F-1)', visible::text);
  else perform pg_temp.cert_fail('Announcements', 'rejected cell leader delete returns 0 rows (F-1)', visible::text); end if;

  -- Regression: active cell leader must still be able to insert announcements.
  perform pg_temp.as_auth(leader_id);
  begin
    insert into public.announcements (title, body, author_id, author_name)
      values ('Cert Active Insert', 'cert body', leader_id, 'Cert Leader');
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Announcements', 'active cell leader can still insert announcement (F-1 regression)', 'insert succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('Announcements', 'active cell leader can still insert announcement (F-1 regression)', sqlerrm);
  end;

  -- Restore rejected_id role to member for remaining tests.
  update public.profiles set role = 'member' where id = rejected_id;

  -- ===== FIRST-ADMINISTRATOR BOOTSTRAP ====================================================================================
  -- (an active coordinator already exists in this fixture, so remove the roles to simulate a clean project)
  update public.profiles set role = 'member', status = 'active' where id in (admin_id, coord_id, leader_id);

  perform pg_temp.as_auth(member_id);
  begin perform public.bootstrap_first_administrator('cert.guard.owner@example.test');
    perform pg_temp.as_postgres(); perform pg_temp.cert_fail('Bootstrap', 'a signed-in user cannot run the bootstrap', 'call succeeded');
  exception when others then perform pg_temp.as_postgres(); perform pg_temp.cert_pass('Bootstrap', 'a signed-in user cannot run the bootstrap', sqlerrm); end;

  select (not has_function_privilege('anon', 'public.bootstrap_first_administrator(text,text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.bootstrap_first_administrator(text,text)', 'EXECUTE')
          and not has_function_privilege('service_role', 'public.bootstrap_first_administrator(text,text)', 'EXECUTE'))::text into state;
  if state = 'true' then perform pg_temp.cert_pass('Bootstrap', 'no API role can execute the bootstrap function', state);
  else perform pg_temp.cert_fail('Bootstrap', 'no API role can execute the bootstrap function', state); end if;

  select (not has_table_privilege('anon', 'public.admin_bootstrap_audit', 'SELECT')
          and not has_table_privilege('authenticated', 'public.admin_bootstrap_audit', 'SELECT')
          and not has_table_privilege('service_role', 'public.admin_bootstrap_audit', 'SELECT'))::text into state;
  if state = 'true' then perform pg_temp.cert_pass('Bootstrap', 'the bootstrap audit table is unreachable by API roles', state);
  else perform pg_temp.cert_fail('Bootstrap', 'the bootstrap audit table is unreachable by API roles', state); end if;

  begin perform public.bootstrap_first_administrator('nobody.here@example.test');
    perform pg_temp.cert_fail('Bootstrap', 'an unknown email is refused (no account is ever created)', 'call succeeded');
  exception when others then perform pg_temp.cert_pass('Bootstrap', 'an unknown email is refused (no account is ever created)', sqlerrm); end;

  perform public.bootstrap_first_administrator('Cert.Guard.OWNER@example.test', 'certification run');
  select role || '/' || status into state from public.profiles where id = owner_id;
  if state = 'coordinator/active' then perform pg_temp.cert_pass('Bootstrap', 'the owner promotes the signed-up account to coordinator + active', state);
  else perform pg_temp.cert_fail('Bootstrap', 'the owner promotes the signed-up account to coordinator + active', state); end if;

  select m.role || '/' || m.status into state from public.memberships m join public.profiles p on p.person_id = m.person_id where p.id = owner_id and m.status = 'active';
  if state = 'coordinator/active' then perform pg_temp.cert_pass('Bootstrap', 'an active coordinator membership exists for the same person', state);
  else perform pg_temp.cert_fail('Bootstrap', 'an active coordinator membership exists for the same person', coalesce(state, 'none')); end if;

  select count(*) into visible from public.membership_transitions t join public.profiles p on p.person_id = t.person_id where p.id = owner_id and t.to_type = 'member';
  if visible = 1 then perform pg_temp.cert_pass('Bootstrap', 'a membership transition was recorded', visible::text);
  else perform pg_temp.cert_fail('Bootstrap', 'a membership transition was recorded', visible::text); end if;

  select count(*) into visible from public.admin_bootstrap_audit where target_user_id = owner_id and performed_by = 'postgres';
  if visible = 1 then perform pg_temp.cert_pass('Bootstrap', 'the action is audited (who, when, target)', visible::text);
  else perform pg_temp.cert_fail('Bootstrap', 'the action is audited (who, when, target)', visible::text); end if;

  begin perform public.bootstrap_first_administrator('cert.guard.second@example.test');
    perform pg_temp.cert_fail('Bootstrap', 'the bootstrap works only once', 'second call succeeded');
  exception when others then perform pg_temp.cert_pass('Bootstrap', 'the bootstrap works only once', sqlerrm); end;

  delete from public.admin_bootstrap_audit;
  begin perform public.bootstrap_first_administrator('cert.guard.second@example.test');
    perform pg_temp.cert_fail('Bootstrap', 'it refuses while an active administrator exists', 'call succeeded');
  exception when others then perform pg_temp.cert_pass('Bootstrap', 'it refuses while an active administrator exists', sqlerrm); end;
end $$;

select area, check_name, result, left(coalesce(evidence, ''), 90) as evidence from cert_results order by area desc, check_name;
select count(*) filter (where result = 'FAIL') as failures, count(*) as checks from cert_results;
rollback;
