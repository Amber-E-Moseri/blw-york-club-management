-- cert_044_bsc_access.sql
-- Behavioural certification for migrations 040, 042 and 044 (Bible Study Class access).
-- Run inside a transaction (rolled back at end) against a local stack with all migrations applied.
--
-- Scenarios: anonymous, pending, rejected, inactive, active member, active cell leader, active coordinator,
-- unauthorised writes, and the two gaps found in review (BSC leader and peer visibility after account
-- deactivation, and self-assignment of bsc_id by a pending account).
--
-- KNOWN_GAP rows are recorded, not passed. They describe a limit that this migration does not close.
begin;

create temporary table cert_results (area text not null, check_name text not null, result text not null, evidence text) on commit drop;

create or replace function pg_temp.cert_pass(area text, check_name text, evidence text default null)
returns void language plpgsql security definer as $$ begin insert into cert_results values (area, check_name, 'PASS', evidence); end $$;
create or replace function pg_temp.cert_fail(area text, check_name text, evidence text)
returns void language plpgsql security definer as $$ begin insert into cert_results values (area, check_name, 'FAIL', evidence); end $$;
create or replace function pg_temp.cert_known_gap(area text, check_name text, evidence text)
returns void language plpgsql security definer as $$ begin insert into cert_results values (area, check_name, 'KNOWN_GAP', evidence); end $$;

create or replace function pg_temp.as_auth(user_id uuid)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_anon()
returns void language plpgsql as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
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
  u_pending        uuid := '44000000-0000-0000-0000-000000000001';
  u_rejected       uuid := '44000000-0000-0000-0000-000000000002';
  u_inactive       uuid := '44000000-0000-0000-0000-000000000003';
  u_active_member  uuid := '44000000-0000-0000-0000-000000000004';
  u_bsc_leader     uuid := '44000000-0000-0000-0000-000000000005';
  u_cell_leader    uuid := '44000000-0000-0000-0000-000000000006';
  u_rej_cell_lead  uuid := '44000000-0000-0000-0000-000000000007';
  u_coordinator    uuid := '44000000-0000-0000-0000-000000000008';
  u_inactive_coord uuid := '44000000-0000-0000-0000-000000000009';
  u_inactive_lead  uuid := '44000000-0000-0000-0000-00000000000a';
  u_bsc3_member    uuid := '44000000-0000-0000-0000-00000000000b';
  u_peer           uuid := '44000000-0000-0000-0000-00000000000c';
  cell_a           uuid := '44000000-0000-0000-0000-0000000000c1';
  cell_b           uuid := '44000000-0000-0000-0000-0000000000c2';
  bsc1             uuid := '44000000-0000-0000-0000-0000000000b1';
  bsc2             uuid := '44000000-0000-0000-0000-0000000000b2';
  bsc3             uuid := '44000000-0000-0000-0000-0000000000b3';
  c1 uuid := '44000000-0000-0000-0000-0000000000d1';
  c2 uuid := '44000000-0000-0000-0000-0000000000d2';
  c3 uuid := '44000000-0000-0000-0000-0000000000d3';
  c5 uuid := '44000000-0000-0000-0000-0000000000d5';
  n int;
  v text;
begin
  -- ── Seed (as postgres; RLS bypassed) ─────────────────────────────────────────
  insert into auth.users (id, email, role, aud, raw_user_meta_data, created_at, updated_at, confirmation_token, email_confirmed_at)
  select id, id::text || '@cert044.example.test', 'authenticated', 'authenticated', '{}', now(), now(), '', now()
  from (values (u_pending),(u_rejected),(u_inactive),(u_active_member),(u_bsc_leader),(u_cell_leader),(u_rej_cell_lead),
               (u_coordinator),(u_inactive_coord),(u_inactive_lead),(u_bsc3_member),(u_peer)) as t(id)
  on conflict do nothing;

  insert into public.profiles (id, email, full_name, role, status, cell_id, bsc_id) values
    (u_pending,        u_pending::text||'@cert044.example.test',        'Cert Pending',        'member',      'pending', null, null),
    (u_rejected,       u_rejected::text||'@cert044.example.test',       'Cert Rejected',       'member',      'rejected', null, null),
    (u_inactive,       u_inactive::text||'@cert044.example.test',       'Cert Inactive',       'member',      'inactive', null, null),
    (u_active_member,  u_active_member::text||'@cert044.example.test',  'Cert Active Member',  'member',      'active', null, null),
    (u_bsc_leader,     u_bsc_leader::text||'@cert044.example.test',     'Cert BSC Leader',     'member',      'active', null, null),
    (u_cell_leader,    u_cell_leader::text||'@cert044.example.test',    'Cert Cell Leader',    'cell_leader', 'active', null, null),
    (u_rej_cell_lead,  u_rej_cell_lead::text||'@cert044.example.test',  'Cert Rejected Cell Leader', 'cell_leader', 'rejected', null, null),
    (u_coordinator,    u_coordinator::text||'@cert044.example.test',    'Cert Coordinator',    'coordinator', 'active', null, null),
    (u_inactive_coord, u_inactive_coord::text||'@cert044.example.test', 'Cert Inactive Coordinator', 'coordinator', 'inactive', null, null),
    (u_inactive_lead,  u_inactive_lead::text||'@cert044.example.test',  'Cert Inactive BSC Leader', 'member',  'inactive', null, null),
    (u_bsc3_member,    u_bsc3_member::text||'@cert044.example.test',    'Cert BSC3 Member',    'member',      'active', null, null),
    (u_peer,           u_peer::text||'@cert044.example.test',           'Cert Active BSC Peer', 'member',     'active', null, null)
  on conflict (id) do update set status = excluded.status, role = excluded.role, cell_id = excluded.cell_id, bsc_id = excluded.bsc_id;

  insert into public.cells (id, name, leader_id) values
    (cell_a, 'Cert Cell A', u_cell_leader),
    (cell_b, 'Cert Cell B', u_rej_cell_lead)
  on conflict (id) do update set leader_id = excluded.leader_id;

  insert into public.bscs (id, cell_id, name, leader_id) values
    (bsc1, cell_a, 'Cert BSC 1', u_bsc_leader),
    (bsc2, cell_b, 'Cert BSC 2', null),
    (bsc3, cell_b, 'Cert BSC 3', u_inactive_lead)
  on conflict (id) do update set leader_id = excluded.leader_id, cell_id = excluded.cell_id;


  update public.profiles set cell_id = cell_a, bsc_id = bsc1 where id in (u_rejected, u_inactive, u_active_member, u_bsc_leader, u_peer);
  update public.profiles set cell_id = cell_a where id in (u_pending, u_cell_leader);
  update public.profiles set cell_id = cell_b, bsc_id = bsc3 where id in (u_inactive_lead, u_bsc3_member);
  update public.profiles set cell_id = cell_b where id = u_rej_cell_lead;

  insert into public.people (id, full_name) values (c1,'Person C1'),(c2,'Person C2'),(c3,'Person C3'),(c5,'Person C5') on conflict (id) do nothing;
  insert into public.contacts (id, contact_name, cell_id, logged_by, contact_phone, notes, person_id) values
    (c1, 'Cert Contact One',  cell_a, u_active_member, 'PHONE-C1', 'NOTE-C1', c1),
    (c2, 'Cert Contact Two',  cell_a, u_rejected,      'PHONE-C2', 'NOTE-C2', c2),
    (c3, 'Cert Contact Three',cell_a, u_inactive,      'PHONE-C3', 'NOTE-C3', c3),
    (c5, 'Cert Contact Five', cell_b, u_bsc3_member,   'PHONE-C5', 'NOTE-C5', c5)
  on conflict (id) do update set logged_by = excluded.logged_by, cell_id = excluded.cell_id;

  -- ── 1. Anonymous: denied ─────────────────────────────────────────────────────
  perform pg_temp.as_anon();
  begin
    select count(*) into n from public.bscs;
    if n = 0 then
      perform pg_temp.cert_pass('1 anonymous', 'anon reads no BSC rows', n::text);
    else
      perform pg_temp.cert_fail('1 anonymous', 'anon reads no BSC rows', n::text || ' rows visible');
    end if;
  exception when others then
    perform pg_temp.cert_pass('1 anonymous', 'anon reads no BSC rows', sqlerrm);
  end;
  perform pg_temp.as_postgres();

  -- ── 2. Pending account: denied ───────────────────────────────────────────────
  perform pg_temp.as_auth(u_pending);
  select count(*) into n from public.bscs;
  if n = 0 then perform pg_temp.cert_pass('2 pending', 'pending account reads no BSC rows', n::text);
  else perform pg_temp.cert_fail('2 pending', 'pending account reads no BSC rows', n::text || ' rows visible'); end if;
  select count(*) into n from public.contacts_bsc_view where id = c1;
  if n = 0 then perform pg_temp.cert_pass('2 pending', 'pending account sees no BSC-peer contacts', n::text);
  else perform pg_temp.cert_fail('2 pending', 'pending account sees no BSC-peer contacts', n::text || ' rows visible'); end if;
  perform pg_temp.as_postgres();

  -- ── 3. Rejected account: denied (BSC rows, peer contacts, own contacts) ──────
  perform pg_temp.as_auth(u_rejected);
  select count(*) into n from public.bscs;
  if n = 0 then perform pg_temp.cert_pass('3 rejected', 'rejected account reads no BSC rows', n::text);
  else perform pg_temp.cert_fail('3 rejected', 'rejected account reads no BSC rows', n::text || ' rows visible'); end if;
  select count(*) into n from public.contacts_bsc_view where id = c1;
  if n = 0 then perform pg_temp.cert_pass('3 rejected', 'rejected BSC peer sees no contacts of the BSC', n::text);
  else perform pg_temp.cert_fail('3 rejected', 'rejected BSC peer sees no contacts of the BSC', n::text || ' rows visible'); end if;
  select count(*) into n from public.contacts_bsc_view where id = c2;
  if n = 0 then perform pg_temp.cert_pass('3 rejected', 'rejected account cannot read its own logged contact', n::text);
  else perform pg_temp.cert_fail('3 rejected', 'rejected account cannot read its own logged contact', n::text || ' rows visible'); end if;
  perform pg_temp.as_postgres();

  -- ── 4. Inactive account: denied ──────────────────────────────────────────────
  perform pg_temp.as_auth(u_inactive);
  select count(*) into n from public.bscs;
  if n = 0 then perform pg_temp.cert_pass('4 inactive', 'inactive account reads no BSC rows', n::text);
  else perform pg_temp.cert_fail('4 inactive', 'inactive account reads no BSC rows', n::text || ' rows visible'); end if;
  select count(*) into n from public.contacts_bsc_view where id = c3;
  if n = 0 then perform pg_temp.cert_pass('4 inactive', 'inactive account cannot read its own logged contact', n::text);
  else perform pg_temp.cert_fail('4 inactive', 'inactive account cannot read its own logged contact', n::text || ' rows visible'); end if;
  perform pg_temp.as_postgres();

  -- ── 5. Active approved member: BSC rows, masked peer view, no cross-BSC access ──
  perform pg_temp.as_auth(u_active_member);
  select count(*) into n from public.bscs;
  if n = 3 then perform pg_temp.cert_pass('5 active member', 'active member reads the BSC list', n::text);
  else perform pg_temp.cert_fail('5 active member', 'active member reads the BSC list', n::text || ' rows visible, expected 3'); end if;
  -- Own contact is not masked for the logger; peer masking applies to others' contacts.
  select count(*) into n from public.contacts_bsc_view where id = c1 and contact_phone = 'PHONE-C1';
  if n = 1 then perform pg_temp.cert_pass('5 active member', 'logger sees full detail of own contact', 'PHONE-C1');
  else perform pg_temp.cert_fail('5 active member', 'logger sees full detail of own contact', 'not visible'); end if;
  perform pg_temp.as_postgres();

  -- Active BSC peer (not the logger, not the leader): sees the contact, with phone and notes masked.
  perform pg_temp.as_auth(u_peer);
  select count(*) into n from public.contacts_bsc_view
    where id = c1 and contact_phone is null and notes is null and sensitive_hidden = true;
  if n = 1 then perform pg_temp.cert_pass('5 active member', 'active BSC peer sees contact with phone and notes masked', 'masked');
  else perform pg_temp.cert_fail('5 active member', 'active BSC peer sees contact with phone and notes masked', 'not masked'); end if;
  perform pg_temp.as_postgres();

  perform pg_temp.as_auth(u_bsc_leader);
  select count(*) into n from public.contacts_bsc_view where id = c1 and contact_phone = 'PHONE-C1';
  if n = 1 then perform pg_temp.cert_pass('5 active member', 'BSC leader sees full detail of member contact', 'PHONE-C1');
  else perform pg_temp.cert_fail('5 active member', 'BSC leader sees full detail of member contact', 'not visible'); end if;
  perform pg_temp.as_postgres();

  perform pg_temp.as_auth(u_active_member);
  select count(*) into n from public.contacts_bsc_view where id = c5;
  if n = 0 then perform pg_temp.cert_pass('5 active member', 'member cannot see contacts of another BSC', n::text);
  else perform pg_temp.cert_fail('5 active member', 'member cannot see contacts of another BSC', n::text || ' rows visible'); end if;
  perform pg_temp.as_postgres();

  -- ── 6. Active cell leader: scoped to cell_a ───────────────────────────────────
  perform pg_temp.as_auth(u_cell_leader);
  select count(*) into n from public.contacts_bsc_view where id = c1 and contact_phone = 'PHONE-C1';
  if n = 1 then perform pg_temp.cert_pass('6 cell leader', 'cell leader sees full detail of contacts in own cell', 'PHONE-C1');
  else perform pg_temp.cert_fail('6 cell leader', 'cell leader sees full detail of contacts in own cell', 'not visible'); end if;
  select count(*) into n from public.contacts_bsc_view where id = c5;
  if n = 0 then perform pg_temp.cert_pass('6 cell leader', 'cell leader sees no contacts of another cell', n::text);
  else perform pg_temp.cert_fail('6 cell leader', 'cell leader sees no contacts of another cell', n::text || ' rows visible'); end if;
  begin
    insert into public.bscs (cell_id, name) values (cell_a, 'Cert Cell Leader BSC');
    perform pg_temp.cert_pass('6 cell leader', 'cell leader can create a BSC in own cell', null);
  exception when others then
    perform pg_temp.cert_fail('6 cell leader', 'cell leader can create a BSC in own cell', sqlerrm);
  end;
  begin
    insert into public.bscs (cell_id, name) values (cell_b, 'Cert Cross Cell BSC');
    perform pg_temp.cert_fail('6 cell leader', 'cell leader cannot create a BSC in another cell', 'insert succeeded');
  exception when others then
    perform pg_temp.cert_pass('6 cell leader', 'cell leader cannot create a BSC in another cell', sqlerrm);
  end;
  perform pg_temp.as_postgres();

  -- ── 7. Active coordinator: authorised across cells ───────────────────────────
  perform pg_temp.as_auth(u_coordinator);
  select count(*) into n from public.contacts_bsc_view where id = c5 and contact_phone = 'PHONE-C5';
  if n = 1 then perform pg_temp.cert_pass('7 coordinator', 'coordinator sees full detail of any contact', 'PHONE-C5');
  else perform pg_temp.cert_fail('7 coordinator', 'coordinator sees full detail of any contact', 'not visible'); end if;
  begin
    insert into public.bscs (cell_id, name) values (cell_b, 'Cert Coordinator BSC');
    perform pg_temp.cert_pass('7 coordinator', 'coordinator can create a BSC in any cell', null);
  exception when others then
    perform pg_temp.cert_fail('7 coordinator', 'coordinator can create a BSC in any cell', sqlerrm);
  end;
  perform pg_temp.as_postgres();

  -- ── 8. Unauthorised writes ───────────────────────────────────────────────────
  perform pg_temp.as_auth(u_pending);
  begin
    insert into public.bscs (cell_id, name) values (cell_a, 'Cert Pending BSC');
    perform pg_temp.cert_fail('8 writes', 'pending account cannot create a BSC', 'insert succeeded');
  exception when others then
    perform pg_temp.cert_pass('8 writes', 'pending account cannot create a BSC', sqlerrm);
  end;
  -- Self-assignment to a BSC (the bsc_id bypass): must be refused, and must leave bsc_id unchanged.
  begin
    update public.profiles set bsc_id = bsc2 where id = u_pending;
  exception when others then
    null;
  end;
  perform pg_temp.as_postgres();
  select bsc_id into v from public.profiles where id = u_pending;
  if v is null then perform pg_temp.cert_pass('8 writes', 'pending account cannot assign itself to a BSC', 'bsc_id unchanged');
  else perform pg_temp.cert_fail('8 writes', 'pending account cannot assign itself to a BSC', 'bsc_id=' || v); end if;

  perform pg_temp.as_auth(u_rej_cell_lead);
  begin
    insert into public.bscs (cell_id, name) values (cell_b, 'Cert Rejected Leader BSC');
    perform pg_temp.cert_fail('8 writes', 'rejected cell leader cannot create a BSC', 'insert succeeded');
  exception when others then
    perform pg_temp.cert_pass('8 writes', 'rejected cell leader cannot create a BSC', sqlerrm);
  end;
  perform pg_temp.as_postgres();

  perform pg_temp.as_auth(u_inactive_coord);
  begin
    insert into public.bscs (cell_id, name) values (cell_b, 'Cert Inactive Coordinator BSC');
    perform pg_temp.cert_fail('8 writes', 'inactive coordinator cannot create a BSC', 'insert succeeded');
  exception when others then
    perform pg_temp.cert_pass('8 writes', 'inactive coordinator cannot create a BSC', sqlerrm);
  end;
  perform pg_temp.as_postgres();

  perform pg_temp.as_auth(u_active_member);
  update public.bscs set name = 'Renamed by member' where id = bsc1;
  get diagnostics n = row_count;
  perform pg_temp.as_postgres();
  select name into v from public.bscs where id = bsc1;
  if v = 'Cert BSC 1' then perform pg_temp.cert_pass('8 writes', 'active member cannot rename a BSC', 'rows=' || n);
  else perform pg_temp.cert_fail('8 writes', 'active member cannot rename a BSC', 'name changed to ' || v); end if;

  -- Active member moving another member into a BSC: must be refused (profiles row not theirs).
  -- Reset the pending account first so the earlier self-assignment result cannot leak into this check.
  update public.profiles set bsc_id = null where id = u_pending;
  perform pg_temp.as_auth(u_active_member);
  update public.profiles set bsc_id = bsc2 where id = u_pending;
  get diagnostics n = row_count;
  perform pg_temp.as_postgres();
  select bsc_id into v from public.profiles where id = u_pending;
  if v is null then perform pg_temp.cert_pass('8 writes', 'active member cannot assign another member to a BSC', 'rows=' || n);
  else perform pg_temp.cert_fail('8 writes', 'active member cannot assign another member to a BSC', 'bsc_id=' || v); end if;

  -- Positive control: a coordinator may still assign BSC membership (the guard must not block staff).
  perform pg_temp.as_auth(u_coordinator);
  update public.profiles set bsc_id = bsc2 where id = u_bsc3_member;
  get diagnostics n = row_count;
  perform pg_temp.as_postgres();
  select bsc_id into v from public.profiles where id = u_bsc3_member;
  if v = bsc2::text then perform pg_temp.cert_pass('8 writes', 'coordinator can assign BSC membership (positive control)', 'rows=' || n);
  else perform pg_temp.cert_fail('8 writes', 'coordinator can assign BSC membership (positive control)', 'bsc_id=' || coalesce(v, 'null')); end if;

  -- ── 9. Gaps from review: deactivated BSC leader and peer retain no access ────
  perform pg_temp.as_auth(u_inactive_lead);
  select count(*) into n from public.contacts_bsc_view where id = c5;
  if n = 0 then perform pg_temp.cert_pass('9 deactivated BSC leader', 'inactive BSC leader cannot read contacts of their BSC', n::text);
  else perform pg_temp.cert_fail('9 deactivated BSC leader', 'inactive BSC leader cannot read contacts of their BSC', n::text || ' rows visible'); end if;
  perform pg_temp.as_postgres();

  perform pg_temp.as_auth(u_rejected);
  select count(*) into n from public.contacts_bsc_view where id = c1;
  if n = 0 then perform pg_temp.cert_pass('9 deactivated peer', 'rejected BSC peer cannot read a member contact', n::text);
  else perform pg_temp.cert_fail('9 deactivated peer', 'rejected BSC peer cannot read a member contact', n::text || ' rows visible'); end if;
  perform pg_temp.as_postgres();

  -- ── 10. Known limit (recorded, not passed) ───────────────────────────────────
  -- The masking in contacts_bsc_view applies to the view only. A BSC peer can still query the base table, which
  -- returns contact_phone and notes for rows that contacts_read admits. Closing this needs column-level privileges
  -- or a masked-view-only design, which is out of scope here.
  perform pg_temp.as_auth(u_active_member);
  select count(*) into n from public.contacts where id = c1 and contact_phone = 'PHONE-C1';
  perform pg_temp.as_postgres();
  if n = 1 then perform pg_temp.cert_known_gap('10 known limit', 'base contacts table exposes phone to a BSC peer', 'peer reads base table directly');
  else perform pg_temp.cert_pass('10 known limit', 'base contacts table exposes phone to a BSC peer', 'not exposed'); end if;

end $$;

select area, check_name, result, left(coalesce(evidence, ''), 90) as evidence from cert_results order by area, check_name;
select count(*) filter (where result = 'FAIL') as failures, count(*) filter (where result = 'KNOWN_GAP') as known_gaps, count(*) as checks from cert_results;
rollback;
