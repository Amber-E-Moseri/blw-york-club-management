-- Targeted messaging certification (migration 067). Run by the certification owner (Agent 6) against an isolated,
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

-- Recording helpers run as the owner so a result is written even while the session is 'authenticated'.
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

  -- Leadership is cells.leader_id (migration 054). Cell A is led by leader_a; cell B has no leader.
  insert into public.cells (id, name, leader_id) values (cell_a, 'Msg Cell A', leader_a_id), (cell_b, 'Msg Cell B', null);

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

-- 13-16. Enumeration and grant checks (migration 066). Own fixture, so this block does not depend on the one above.
do $$
declare
  admin_id uuid := gen_random_uuid();
  in_id uuid := gen_random_uuid();
  out_id uuid := gen_random_uuid();
  grp uuid := gen_random_uuid();
  msg uuid;
  spec uuid;
  seen integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  values
    (admin_id, 'enum-admin@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (in_id,    'enum-in@example.invalid',    'x', 'authenticated', 'authenticated', now(), now()),
    (out_id,   'enum-out@example.invalid',   'x', 'authenticated', 'authenticated', now(), now());
  update public.profiles set status = 'active', role = 'admin' where id = admin_id;
  update public.profiles set status = 'active', role = 'member' where id in (in_id, out_id);
  insert into public.saved_groups (id, name, created_by) values (grp, 'Enum group', admin_id);
  insert into public.saved_group_members (group_id, profile_id, added_by) values (grp, in_id, admin_id);

  perform pg_temp.as_auth(admin_id);
  msg := public.send_message('Enum', 'Private', 'explicit', null, null, array[in_id], array['inbox'], gen_random_uuid());
  perform pg_temp.as_postgres();
  select audience_spec_id into spec from public.communication_messages where id = msg;

  -- 13. A member outside the audience learns nothing: resolve_audience returns no rows for them.
  perform pg_temp.as_auth(out_id);
  select count(*) into seen from public.resolve_audience(spec);
  perform pg_temp.as_postgres();
  if seen = 0 then
    perform pg_temp.cert_pass('authorization', 'outsider cannot enumerate an audience via resolve_audience');
  else
    perform pg_temp.cert_fail('authorization', 'outsider cannot enumerate an audience via resolve_audience', seen::text || ' rows');
  end if;

  -- 14. A member inside the audience sees only their own row, not the whole list.
  perform pg_temp.as_auth(in_id);
  select count(*) into seen from public.resolve_audience(spec);
  perform pg_temp.as_postgres();
  if seen = 1 then
    perform pg_temp.cert_pass('authorization', 'member sees only own row from resolve_audience');
  else
    perform pg_temp.cert_fail('authorization', 'member sees only own row from resolve_audience', seen::text || ' rows');
  end if;

  -- 15. Members cannot read saved-group membership.
  perform pg_temp.as_auth(in_id);
  select count(*) into seen from public.saved_group_members;
  perform pg_temp.as_postgres();
  if seen = 0 then
    perform pg_temp.cert_pass('authorization', 'member cannot read saved_group_members');
  else
    perform pg_temp.cert_fail('authorization', 'member cannot read saved_group_members', seen::text || ' rows');
  end if;

  -- 16. Clients cannot run the internal resolver or the service-only delivery functions.
  perform pg_temp.as_auth(in_id);
  if pg_temp.expect_error(format('select count(*) from public.resolve_audience_all(%L)', spec), 'permission denied') then
    perform pg_temp.cert_pass('grants', 'resolve_audience_all is not executable by authenticated');
  else
    perform pg_temp.cert_fail('grants', 'resolve_audience_all is not executable by authenticated', 'call succeeded');
  end if;
  if pg_temp.expect_error(format('select * from public.claim_deliveries(%L, ''email'')', msg), 'permission denied') then
    perform pg_temp.cert_pass('grants', 'claim_deliveries is not executable by authenticated');
  else
    perform pg_temp.cert_fail('grants', 'claim_deliveries is not executable by authenticated', 'call succeeded');
  end if;
  perform pg_temp.as_postgres();
end $$;

-- 17-19. Leader broadcast, external channels and spec deletion (migrations 066 and 067).
do $$
declare
  staff_id uuid := gen_random_uuid();
  leader_id uuid := gen_random_uuid();
  cell_x uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  spec_x uuid;
  msg uuid;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  values
    (staff_id,  'bc-staff@example.invalid',  'x', 'authenticated', 'authenticated', now(), now()),
    (leader_id, 'bc-leader@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (member_id, 'bc-member@example.invalid', 'x', 'authenticated', 'authenticated', now(), now());
  insert into public.cells (id, name, leader_id) values (cell_x, 'BC Cell', leader_id);
  update public.profiles set status = 'active', role = 'admin' where id = staff_id;
  update public.profiles set status = 'active', role = 'cell_leader', cell_id = cell_x where id = leader_id;
  update public.profiles set status = 'active', role = 'member', cell_id = cell_x where id = member_id;

  -- 17. A cell leader cannot write a fellowship-wide announcement (null spec).
  perform pg_temp.as_auth(leader_id);
  if pg_temp.expect_error(
    format($q$insert into public.announcements (title, body, author_id, author_name) values ('Broadcast', 'x', '%s', 'Leader')$q$, leader_id),
    'row-level security')
  then
    perform pg_temp.cert_pass('broadcast', 'cell leader cannot insert a null-spec announcement');
  else
    perform pg_temp.cert_fail('broadcast', 'cell leader cannot insert a null-spec announcement', 'insert succeeded');
  end if;
  perform pg_temp.as_postgres();

  -- 18. A cell leader cannot send email or push.
  perform pg_temp.as_auth(leader_id);
  if pg_temp.expect_error(
    format($q$select public.send_message('Mail', 'x', 'cells', array['%s'::uuid], null, null, array['inbox','email'], gen_random_uuid())$q$, cell_x),
    'external_channels_restricted')
  then
    perform pg_temp.cert_pass('channels', 'cell leader cannot use email or push');
  else
    perform pg_temp.cert_fail('channels', 'cell leader cannot use email or push', 'send succeeded');
  end if;
  perform pg_temp.as_postgres();

  -- 19. An audience spec that an announcement depends on cannot be deleted; deletion must not broaden the row.
  perform pg_temp.as_auth(staff_id);
  insert into public.audience_specs (mode, cell_ids, created_by) values ('cells', array[cell_x], staff_id) returning id into spec_x;
  perform pg_temp.as_postgres();
  insert into public.announcements (title, body, author_id, author_name, audience_spec_id)
  values ('Cell only', 'x', staff_id, 'Staff', spec_x);
  if pg_temp.expect_error(format('delete from public.audience_specs where id = %L', spec_x), 'foreign key') then
    perform pg_temp.cert_pass('broadcast', 'audience spec in use cannot be deleted');
  else
    perform pg_temp.cert_fail('broadcast', 'audience spec in use cannot be deleted', 'delete succeeded');
  end if;
end $$;

-- 20-25. Leadership is assignment (migration 054): cells.leader_id = caller, on an active account.
do $$
declare
  lead_ab uuid := gen_random_uuid();   -- member of cell X, leads cells X and Y
  lead_b uuid := gen_random_uuid();    -- member of cell X, leads only cell Y
  role_only uuid := gen_random_uuid(); -- role label cell_leader, leads nothing
  former uuid := gen_random_uuid();    -- led cell Z, then was replaced
  member_x uuid := gen_random_uuid();  -- ordinary member
  cell_x uuid := gen_random_uuid();
  cell_y uuid := gen_random_uuid();
  cell_z uuid := gen_random_uuid();
  new_leader uuid := gen_random_uuid();
  msg uuid;
  denied boolean;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  values
    (lead_ab,   'ld-ab@example.invalid',     'x', 'authenticated', 'authenticated', now(), now()),
    (lead_b,    'ld-b@example.invalid',      'x', 'authenticated', 'authenticated', now(), now()),
    (role_only, 'ld-role@example.invalid',   'x', 'authenticated', 'authenticated', now(), now()),
    (former,    'ld-former@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (member_x,  'ld-member@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (new_leader,'ld-new@example.invalid',    'x', 'authenticated', 'authenticated', now(), now());
  update public.profiles set status = 'active', role = 'member', cell_id = cell_x where id = lead_ab;
  update public.profiles set status = 'active', role = 'member', cell_id = cell_x where id = lead_b;
  update public.profiles set status = 'active', role = 'cell_leader', cell_id = null where id = role_only;
  update public.profiles set status = 'active', role = 'cell_leader', cell_id = cell_z where id = former;
  update public.profiles set status = 'active', role = 'member', cell_id = cell_x where id = member_x;
  update public.profiles set status = 'active', role = 'member', cell_id = null where id = new_leader;
  insert into public.cells (id, name, leader_id) values
    (cell_x, 'Ld Cell X', lead_ab),
    (cell_y, 'Ld Cell Y', lead_ab),
    (cell_z, 'Ld Cell Z', former);

  -- 20. Leader belongs to and leads the same cell: may send to it.
  perform pg_temp.as_auth(lead_ab);
  begin
    msg := public.send_message('Own', 'x', 'cells', array[cell_x], null, null, array['inbox'], gen_random_uuid());
    perform pg_temp.cert_pass('leadership', 'leader sends to the cell they belong to and lead');
  exception when others then
    perform pg_temp.cert_fail('leadership', 'leader sends to the cell they belong to and lead', sqlerrm);
  end;
  perform pg_temp.as_postgres();

  -- 21. Leader belongs to cell X but leads only cell Y: may send to Y, not to X.
  perform pg_temp.as_auth(lead_b);
  denied := pg_temp.expect_error(
    format($q$select public.send_message('X','y','cells', array['%s'::uuid], null, null, array['inbox'], gen_random_uuid())$q$, cell_x),
    'outside_cell');
  if denied then
    perform pg_temp.cert_pass('leadership', 'member of X who leads only Y cannot send to X');
  else
    perform pg_temp.cert_fail('leadership', 'member of X who leads only Y cannot send to X', 'send succeeded');
  end if;
  perform pg_temp.as_postgres();

  -- 22. Leader of several cells can send to any of them, one cell at a time or together.
  perform pg_temp.as_auth(lead_ab);
  begin
    msg := public.send_message('Multi', 'x', 'cells', array[cell_x, cell_y], null, null, array['inbox'], gen_random_uuid());
    perform pg_temp.cert_pass('leadership', 'leader of several cells can send to all of them');
  exception when others then
    perform pg_temp.cert_fail('leadership', 'leader of several cells can send to all of them', sqlerrm);
  end;
  perform pg_temp.as_postgres();

  -- 23. Role label alone grants nothing: a cell_leader with no led cell cannot send.
  perform pg_temp.as_auth(role_only);
  denied := pg_temp.expect_error(
    format($q$select public.send_message('R','x','cells', array['%s'::uuid], null, null, array['inbox'], gen_random_uuid())$q$, cell_x),
    'outside_cell');
  if denied then
    perform pg_temp.cert_pass('leadership', 'role label alone grants no cell-leader rights');
  else
    perform pg_temp.cert_fail('leadership', 'role label alone grants no cell-leader rights', 'send succeeded');
  end if;
  perform pg_temp.as_postgres();

  -- 24. Former leader: the cell was reassigned, so the old leader loses control immediately.
  update public.cells set leader_id = new_leader where id = cell_z;
  perform pg_temp.as_auth(former);
  denied := pg_temp.expect_error(
    format($q$select public.send_message('F','x','cells', array['%s'::uuid], null, null, array['inbox'], gen_random_uuid())$q$, cell_z),
    'outside_cell');
  if denied then
    perform pg_temp.cert_pass('leadership', 'former leader no longer controls the cell');
  else
    perform pg_temp.cert_fail('leadership', 'former leader no longer controls the cell', 'send succeeded');
  end if;
  perform pg_temp.as_postgres();

  -- 25. Non-leader member cannot gain messaging rights through cell membership.
  perform pg_temp.as_auth(member_x);
  denied := pg_temp.expect_error(
    format($q$select public.send_message('M','x','cells', array['%s'::uuid], null, null, array['inbox'], gen_random_uuid())$q$, cell_x),
    'outside_cell');
  if denied then
    perform pg_temp.cert_pass('leadership', 'cell member who does not lead cannot send');
  else
    perform pg_temp.cert_fail('leadership', 'cell member who does not lead cannot send', 'send succeeded');
  end if;
  perform pg_temp.as_postgres();
end $$;

select area, check_name, result, evidence from cert_results order by area, check_name;

-- Rolls back all fixtures and results.
rollback;
