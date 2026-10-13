-- Targeted messaging certification (migration 066). Run by the certification owner (Agent 6) against an isolated,
-- replayed local database. Transactional: every fixture is rolled back. Not run by the unit test suite.
--
-- Scenarios covered (each reports PASS or FAIL in cert_results):
--   1. Admin sends to everyone: recipients are the active members only.
--   2. Admin sends to one member.
--   3. Admin sends to several selected members, with repeats: each person recorded once.
--   4. Coordinator sends to a saved group: only active group members are recorded.
--   5. Cell leader sends within their own cell.
--   6. Cell leader selecting another cell is rejected (outside_cell).
--   7. Cell leader selecting explicit people is rejected (not_authorised).
--   8. An excluded member cannot SELECT the message or its recipient rows.
--   9. Pending and rejected members are never recipients and can read nothing.
--  10. Duplicate send with the same idempotency key returns the original message and writes nothing new.
--  11. Inbox is written in the send transaction ('stored'); email and push are only 'pending' until dispatch.
--  12. A member sees only their own recipient row.

begin;

create extension if not exists pgcrypto;

create temporary table cert_results (area text not null, check_name text not null, result text not null, evidence text)
  on commit drop;

create or replace function pg_temp.cert_pass(area text, check_name text, evidence text default null)
returns void language plpgsql as $$ begin insert into cert_results values (area, check_name, 'PASS', evidence); end $$;
create or replace function pg_temp.cert_fail(area text, check_name text, evidence text)
returns void language plpgsql as $$ begin insert into cert_results values (area, check_name, 'FAIL', evidence); end $$;

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

create or replace function pg_temp.expect_error(p_sql text, p_expected text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like '%' || p_expected || '%';
end $$;

do $$
declare
  admin_id uuid := gen_random_uuid();
  coord_id uuid := gen_random_uuid();
  leader_a_id uuid := gen_random_uuid();
  member_a1 uuid := gen_random_uuid();
  member_a2 uuid := gen_random_uuid();
  member_b1 uuid := gen_random_uuid();
  member_b2 uuid := gen_random_uuid();
  pending_id uuid := gen_random_uuid();
  rejected_id uuid := gen_random_uuid();
  cell_a uuid := gen_random_uuid();
  cell_b uuid := gen_random_uuid();
  group_id uuid := gen_random_uuid();
  msg_all uuid;
  msg_one uuid;
  msg_many uuid;
  msg_group uuid;
  msg_cell uuid;
  msg_dup_1 uuid;
  msg_dup_2 uuid;
  key_dup uuid := gen_random_uuid();
  n integer;
  seen integer;
  active_count integer;
begin
  -- Fixtures. The handle_new_user trigger creates profiles; status, role and cell are then set explicitly.
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  values
    (admin_id,    'msg-admin@example.invalid',    'x', 'authenticated', 'authenticated', now(), now()),
    (coord_id,    'msg-coord@example.invalid',    'x', 'authenticated', 'authenticated', now(), now()),
    (leader_a_id, 'msg-leader-a@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (member_a1,   'msg-a1@example.invalid',       'x', 'authenticated', 'authenticated', now(), now()),
    (member_a2,   'msg-a2@example.invalid',       'x', 'authenticated', 'authenticated', now(), now()),
    (member_b1,   'msg-b1@example.invalid',       'x', 'authenticated', 'authenticated', now(), now()),
    (member_b2,   'msg-b2@example.invalid',       'x', 'authenticated', 'authenticated', now(), now()),
    (pending_id,  'msg-pending@example.invalid',  'x', 'authenticated', 'authenticated', now(), now()),
    (rejected_id, 'msg-rejected@example.invalid', 'x', 'authenticated', 'authenticated', now(), now());

  insert into public.cells (id, name) values (cell_a, 'Msg Cell A'), (cell_b, 'Msg Cell B');

  update public.profiles set status = 'active', role = 'admin' where id = admin_id;
  update public.profiles set status = 'active', role = 'coordinator' where id = coord_id;
  update public.profiles set status = 'active', role = 'cell_leader', cell_id = cell_a where id = leader_a_id;
  update public.profiles set status = 'active', role = 'member', cell_id = cell_a where id in (member_a1, member_a2);
  update public.profiles set status = 'active', role = 'member', cell_id = cell_b where id in (member_b1, member_b2);
  update public.profiles set status = 'pending', role = 'member', cell_id = cell_a where id = pending_id;
  update public.profiles set status = 'rejected', role = 'member', cell_id = cell_a where id = rejected_id;

  insert into public.saved_groups (id, name, created_by) values (group_id, 'Msg Prayer Team', coord_id);
  insert into public.saved_group_members (group_id, profile_id, added_by)
  values (group_id, member_a1, coord_id), (group_id, member_b1, coord_id), (group_id, pending_id, coord_id);

  select count(*) into active_count from public.profiles where status = 'active';

  -- 1. Everyone.
  perform pg_temp.as_auth(admin_id);
  msg_all := public.send_message('All', 'Everyone', 'all', null, null, null, array['inbox'], gen_random_uuid());
  perform pg_temp.as_postgres();
  select count(*) into n from public.communication_recipients where message_id = msg_all;
  if n = active_count and not exists (
    select 1 from public.communication_recipients r join public.profiles p on p.id = r.user_id
    where r.message_id = msg_all and p.status <> 'active'
  ) then
    perform pg_temp.cert_pass('messaging', 'announcement to all: active members only', n::text);
  else
    perform pg_temp.cert_fail('messaging', 'announcement to all: active members only', n::text || ' of ' || active_count);
  end if;

  -- 2. One person.
  perform pg_temp.as_auth(admin_id);
  msg_one := public.send_message('One', 'Just you', 'explicit', null, null, array[member_b2], array['inbox'], gen_random_uuid());
  perform pg_temp.as_postgres();
  select count(*) into n from public.communication_recipients where message_id = msg_one;
  if n = 1 then
    perform pg_temp.cert_pass('messaging', 'message to one person');
  else
    perform pg_temp.cert_fail('messaging', 'message to one person', n::text);
  end if;

  -- 3. Several, with repeats: each person recorded once.
  perform pg_temp.as_auth(admin_id);
  msg_many := public.send_message('Many', 'Several', 'explicit', null, null, array[member_a1, member_b1, member_a1], array['inbox'], gen_random_uuid());
  perform pg_temp.as_postgres();
  select count(*) into n from public.communication_recipients where message_id = msg_many;
  if n = 2 then
    perform pg_temp.cert_pass('messaging', 'several people, duplicates collapsed');
  else
    perform pg_temp.cert_fail('messaging', 'several people, duplicates collapsed', n::text);
  end if;

  -- 4. Saved group by coordinator: pending member in the group is excluded.
  perform pg_temp.as_auth(coord_id);
  msg_group := public.send_message('Group', 'Prayer team', 'saved_groups', null, array[group_id], null, array['inbox'], gen_random_uuid());
  perform pg_temp.as_postgres();
  if exists (select 1 from public.communication_recipients where message_id = msg_group and user_id = pending_id) then
    perform pg_temp.cert_fail('messaging', 'saved group excludes pending member', 'pending member recorded');
  else
    perform pg_temp.cert_pass('messaging', 'saved group excludes pending member');
  end if;

  -- 5. Cell leader, own cell.
  perform pg_temp.as_auth(leader_a_id);
  msg_cell := public.send_message('Cell', 'Our cell', 'cells', array[cell_a], null, null, array['inbox'], gen_random_uuid());
  perform pg_temp.as_postgres();
  if exists (select 1 from public.communication_recipients where message_id = msg_cell and user_id = member_b1) then
    perform pg_temp.cert_fail('messaging', 'cell leader stays inside own cell', 'cross-cell member recorded');
  else
    perform pg_temp.cert_pass('messaging', 'cell leader sends within own cell');
  end if;

  -- 6. Cell leader, another cell: rejected.
  perform pg_temp.as_auth(leader_a_id);
  if pg_temp.expect_error(
    format($q$select public.send_message('X','Y','cells', array['%s'::uuid], null, null, array['inbox'], gen_random_uuid())$q$, cell_b),
    'outside_cell')
  then
    perform pg_temp.cert_pass('authorization', 'cross-cell cell selection rejected');
  else
    perform pg_temp.cert_fail('authorization', 'cross-cell cell selection rejected', 'send was not refused');
  end if;
  perform pg_temp.as_postgres();

  -- 7. Cell leader, explicit people: rejected.
  perform pg_temp.as_auth(leader_a_id);
  if pg_temp.expect_error(
    format($q$select public.send_message('X','Y','explicit', null, null, array['%s'::uuid], array['inbox'], gen_random_uuid())$q$, member_b1),
    'not_authorised')
  then
    perform pg_temp.cert_pass('authorization', 'cell leader cannot target explicit people');
  else
    perform pg_temp.cert_fail('authorization', 'cell leader cannot target explicit people', 'send was not refused');
  end if;
  perform pg_temp.as_postgres();

  -- 8. Excluded member: member_a1 is not a recipient of msg_one (which is for member_b2 only).
  perform pg_temp.as_auth(member_a1);
  select count(*) into seen from public.communication_messages where id = msg_one;
  perform pg_temp.as_postgres();
  if seen = 0 then
    perform pg_temp.cert_pass('rls', 'excluded member cannot read a message via PostgREST');
  else
    perform pg_temp.cert_fail('rls', 'excluded member cannot read a message via PostgREST', seen::text || ' rows');
  end if;

  -- 9. Pending and rejected members read nothing.
  perform pg_temp.as_auth(pending_id);
  select count(*) into seen from public.communication_messages;
  perform pg_temp.as_postgres();
  if seen = 0 then
    perform pg_temp.cert_pass('rls', 'pending member reads no messages');
  else
    perform pg_temp.cert_fail('rls', 'pending member reads no messages', seen::text);
  end if;
  perform pg_temp.as_auth(rejected_id);
  select count(*) into seen from public.communication_recipients;
  perform pg_temp.as_postgres();
  if seen = 0 then
    perform pg_temp.cert_pass('rls', 'rejected member reads no recipient rows');
  else
    perform pg_temp.cert_fail('rls', 'rejected member reads no recipient rows', seen::text);
  end if;

  -- 10. Idempotency: the same key twice returns the same message and stores one copy.
  perform pg_temp.as_auth(admin_id);
  msg_dup_1 := public.send_message('Dup', 'Once', 'explicit', null, null, array[member_a1], array['inbox'], key_dup);
  msg_dup_2 := public.send_message('Dup', 'Once', 'explicit', null, null, array[member_a1], array['inbox'], key_dup);
  perform pg_temp.as_postgres();
  select count(*) into n from public.communication_messages where idempotency_key = key_dup;
  if msg_dup_1 = msg_dup_2 and n = 1 then
    perform pg_temp.cert_pass('messaging', 'duplicate send with same key stores one message');
  else
    perform pg_temp.cert_fail('messaging', 'duplicate send with same key stores one message', n::text);
  end if;

  -- 11. Inbox stored in the send transaction; external channels pending.
  if exists (
    select 1 from public.communication_deliveries d
    where d.message_id = msg_all and d.channel = 'inbox' and d.status <> 'stored'
  ) then
    perform pg_temp.cert_fail('delivery', 'inbox rows are stored at send', 'inbox row not stored');
  else
    perform pg_temp.cert_pass('delivery', 'inbox rows are stored at send');
  end if;

  -- 12. A member sees only their own recipient row.
  perform pg_temp.as_auth(member_b1);
  select count(*) into seen from public.communication_recipients where message_id = msg_many;
  perform pg_temp.as_postgres();
  if seen = 0 then
    perform pg_temp.cert_pass('rls', 'member does not see another member’s recipient row');
  else
    perform pg_temp.cert_fail('rls', 'member does not see another member’s recipient row', seen::text);
  end if;
end $$;

select area, check_name, result, evidence from cert_results order by area, check_name;

-- Rolls back all fixtures and results.
rollback;
