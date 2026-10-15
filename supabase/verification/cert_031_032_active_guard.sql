-- cert_031_032_active_guard.sql
-- Behavioural certification for migrations 031 and 032.
-- Run inside a transaction (rolled back at end) against a local stack with all migrations applied.
--
-- Migration 031: adds status = 'active' guard to announcements_manage cell_leader branch.
-- Migration 032: splits event_rsvps_own and confession_declarations_own into read/write
--               policies with is_active_member() guard on writes.
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
  active_leader_id    uuid := '30000000-0000-0000-0000-000000000001';
  rejected_leader_id  uuid := '30000000-0000-0000-0000-000000000002';
  inactive_leader_id  uuid := '30000000-0000-0000-0000-000000000003';
  pending_member_id   uuid := '30000000-0000-0000-0000-000000000004';
  active_member_id    uuid := '30000000-0000-0000-0000-000000000005';
  rejected_member_id  uuid := '30000000-0000-0000-0000-000000000006';
  ann_id              uuid := '30000000-0000-0000-0000-000000000020';
  event_id_v          uuid := '30000000-0000-0000-0000-000000000030';
  confession_id_v     uuid := '30000000-0000-0000-0000-000000000040';
  row_count           int;
begin
  -- Seed: auth + profiles
  insert into auth.users (id, email, role, aud, raw_user_meta_data, created_at, updated_at, confirmation_token, email_confirmed_at)
  values
    (active_leader_id,   'cert.031.active_leader@example.test',   'authenticated', 'authenticated', '{"full_name":"Cert Active Leader"}',   now(), now(), '', now()),
    (rejected_leader_id, 'cert.031.rej_leader@example.test',      'authenticated', 'authenticated', '{"full_name":"Cert Rejected Leader"}', now(), now(), '', now()),
    (inactive_leader_id, 'cert.031.inact_leader@example.test',    'authenticated', 'authenticated', '{"full_name":"Cert Inactive Leader"}', now(), now(), '', now()),
    (pending_member_id,  'cert.032.pending_member@example.test',  'authenticated', 'authenticated', '{"full_name":"Cert Pending Member"}',  now(), now(), '', now()),
    (active_member_id,   'cert.032.active_member@example.test',   'authenticated', 'authenticated', '{"full_name":"Cert Active Member"}',   now(), now(), '', now()),
    (rejected_member_id, 'cert.032.rej_member@example.test',      'authenticated', 'authenticated', '{"full_name":"Cert Rejected Member"}', now(), now(), '', now())
  on conflict do nothing;

  insert into public.profiles (id, email, full_name, role, status)
  values
    (active_leader_id,   'cert.031.active_leader@example.test',   'Cert Active Leader',   'cell_leader',  'active'),
    (rejected_leader_id, 'cert.031.rej_leader@example.test',      'Cert Rejected Leader', 'cell_leader',  'rejected'),
    (inactive_leader_id, 'cert.031.inact_leader@example.test',    'Cert Inactive Leader', 'cell_leader',  'inactive'),
    (pending_member_id,  'cert.032.pending_member@example.test',  'Cert Pending Member',  'member',       'pending'),
    (active_member_id,   'cert.032.active_member@example.test',   'Cert Active Member',   'member',       'active'),
    (rejected_member_id, 'cert.032.rej_member@example.test',      'Cert Rejected Member', 'member',       'rejected')
  -- The signup trigger already created each profile as 'pending'; DO NOTHING would silently keep that and make
  -- every 'active' fixture pending. Force the intended role/status so positive and negative checks mean something.
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status;

  -- Seed: one announcement (inserted as postgres to bypass RLS)
  insert into public.announcements (id, title, body, author_id, author_name, created_at)
  values (ann_id, 'Cert Announcement', 'Test body', active_leader_id, 'Cert Active Leader', now())
  on conflict do nothing;

  -- Seed: an event for event_rsvps FK (event_id → events.id)
  insert into public.events (id, title, date, category, created_by, created_at)
  values (event_id_v, 'Cert Event', current_date + 7, 'Other', active_leader_id, now())
  on conflict do nothing;

  -- Seed: a confession for confession_declarations FK (confession_id → confessions.id)
  insert into public.confessions (id, title, body, scheduled_date, created_by, is_active, created_at)
  values (confession_id_v, 'Cert Confession', 'Cert body', current_date + 7, active_leader_id, true, now())
  on conflict do nothing;

  --------------------------------------------------------------------------
  -- BLOCK A: announcements_manage — migration 031
  --------------------------------------------------------------------------

  -- A1: active cell leader CAN manage announcements
  perform pg_temp.as_auth(active_leader_id);
  begin
    insert into public.announcements (id, title, body, author_id, author_name, created_at)
    values ('30000000-0000-0000-0000-000000000021'::uuid, 'Cell Leader Insert Test', 'test body', active_leader_id, 'Cert Active Leader', now());
    get diagnostics row_count = row_count;
    if row_count = 1 then
      perform pg_temp.cert_pass('031 announcements', 'active cell_leader can insert announcement', row_count::text);
    else
      perform pg_temp.cert_fail('031 announcements', 'active cell_leader can insert announcement', 'insert returned 0 rows');
    end if;
  exception when others then
    perform pg_temp.cert_fail('031 announcements', 'active cell_leader can insert announcement', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.announcements where id = '30000000-0000-0000-0000-000000000021'::uuid;

  -- A2: rejected cell leader CANNOT manage announcements (the 031 fix)
  perform pg_temp.as_auth(rejected_leader_id);
  begin
    insert into public.announcements (id, title, body, author_id, author_name, created_at)
    values ('30000000-0000-0000-0000-000000000022'::uuid, 'Rejected Leader Insert', 'test body', rejected_leader_id, 'Cert Rejected Leader', now());
    perform pg_temp.cert_fail('031 announcements', 'rejected cell_leader cannot insert announcement', 'insert succeeded unexpectedly');
  exception when others then
    perform pg_temp.cert_pass('031 announcements', 'rejected cell_leader cannot insert announcement', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.announcements where id = '30000000-0000-0000-0000-000000000022'::uuid;

  -- A3: inactive cell leader CANNOT manage announcements (the 031 fix)
  perform pg_temp.as_auth(inactive_leader_id);
  begin
    insert into public.announcements (id, title, body, author_id, author_name, created_at)
    values ('30000000-0000-0000-0000-000000000023'::uuid, 'Inactive Leader Insert', 'test body', inactive_leader_id, 'Cert Inactive Leader', now());
    perform pg_temp.cert_fail('031 announcements', 'inactive cell_leader cannot insert announcement', 'insert succeeded unexpectedly');
  exception when others then
    perform pg_temp.cert_pass('031 announcements', 'inactive cell_leader cannot insert announcement', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.announcements where id = '30000000-0000-0000-0000-000000000023'::uuid;

  --------------------------------------------------------------------------
  -- BLOCK B: event_rsvps — migration 032
  --------------------------------------------------------------------------

  -- B1: active member CAN insert RSVP
  perform pg_temp.as_auth(active_member_id);
  begin
    insert into public.event_rsvps (user_id, event_id)
    values (active_member_id, event_id_v);
    get diagnostics row_count = row_count;
    if row_count = 1 then
      perform pg_temp.cert_pass('032 event_rsvps', 'active member can insert RSVP', row_count::text);
    else
      perform pg_temp.cert_fail('032 event_rsvps', 'active member can insert RSVP', 'insert returned 0 rows');
    end if;
  exception when others then
    perform pg_temp.cert_fail('032 event_rsvps', 'active member can insert RSVP', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.event_rsvps where user_id = active_member_id and event_id = event_id_v;

  -- B2: pending member CANNOT insert RSVP (the 032 fix)
  perform pg_temp.as_auth(pending_member_id);
  begin
    insert into public.event_rsvps (user_id, event_id)
    values (pending_member_id, event_id_v);
    perform pg_temp.cert_fail('032 event_rsvps', 'pending member cannot insert RSVP', 'insert succeeded unexpectedly');
  exception when others then
    perform pg_temp.cert_pass('032 event_rsvps', 'pending member cannot insert RSVP', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.event_rsvps where user_id = pending_member_id and event_id = event_id_v;

  -- B3: rejected member CANNOT insert RSVP (the 032 fix)
  perform pg_temp.as_auth(rejected_member_id);
  begin
    insert into public.event_rsvps (user_id, event_id)
    values (rejected_member_id, event_id_v);
    perform pg_temp.cert_fail('032 event_rsvps', 'rejected member cannot insert RSVP', 'insert succeeded unexpectedly');
  exception when others then
    perform pg_temp.cert_pass('032 event_rsvps', 'rejected member cannot insert RSVP', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.event_rsvps where user_id = rejected_member_id and event_id = event_id_v;

  -- B4: pending member CAN still read their own RSVPs (read policy preserved by 032)
  insert into public.event_rsvps (user_id, event_id)
  values (pending_member_id, event_id_v);
  perform pg_temp.as_auth(pending_member_id);
  select count(*) into row_count from public.event_rsvps where user_id = pending_member_id and event_id = event_id_v;
  perform pg_temp.as_postgres();
  delete from public.event_rsvps where user_id = pending_member_id and event_id = event_id_v;
  if row_count = 1 then
    perform pg_temp.cert_pass('032 event_rsvps', 'pending member can still read their own RSVP', row_count::text);
  else
    perform pg_temp.cert_fail('032 event_rsvps', 'pending member can still read their own RSVP', row_count::text);
  end if;

  --------------------------------------------------------------------------
  -- BLOCK C: confession_declarations — migration 032
  --------------------------------------------------------------------------

  -- C1: active member CAN insert confession declaration
  perform pg_temp.as_auth(active_member_id);
  begin
    insert into public.confession_declarations (confession_id, user_id)
    values (confession_id_v, active_member_id);
    get diagnostics row_count = row_count;
    if row_count = 1 then
      perform pg_temp.cert_pass('032 confessions', 'active member can insert confession declaration', row_count::text);
    else
      perform pg_temp.cert_fail('032 confessions', 'active member can insert confession declaration', 'insert returned 0 rows');
    end if;
  exception when others then
    perform pg_temp.cert_fail('032 confessions', 'active member can insert confession declaration', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.confession_declarations where user_id = active_member_id and confession_id = confession_id_v;

  -- C2: pending member CANNOT insert confession declaration (the 032 fix)
  perform pg_temp.as_auth(pending_member_id);
  begin
    insert into public.confession_declarations (confession_id, user_id)
    values (confession_id_v, pending_member_id);
    perform pg_temp.cert_fail('032 confessions', 'pending member cannot insert confession declaration', 'insert succeeded unexpectedly');
  exception when others then
    perform pg_temp.cert_pass('032 confessions', 'pending member cannot insert confession declaration', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.confession_declarations where user_id = pending_member_id and confession_id = confession_id_v;

  -- C3: rejected member CANNOT insert confession declaration (the 032 fix)
  perform pg_temp.as_auth(rejected_member_id);
  begin
    insert into public.confession_declarations (confession_id, user_id)
    values (confession_id_v, rejected_member_id);
    perform pg_temp.cert_fail('032 confessions', 'rejected member cannot insert confession declaration', 'insert succeeded unexpectedly');
  exception when others then
    perform pg_temp.cert_pass('032 confessions', 'rejected member cannot insert confession declaration', sqlerrm);
  end;
  perform pg_temp.as_postgres();
  delete from public.confession_declarations where user_id = rejected_member_id and confession_id = confession_id_v;

  -- C4: pending member CAN still read their own declarations (read policy preserved by 032)
  insert into public.confession_declarations (confession_id, user_id) values (confession_id_v, pending_member_id);
  perform pg_temp.as_auth(pending_member_id);
  select count(*) into row_count from public.confession_declarations where user_id = pending_member_id and confession_id = confession_id_v;
  perform pg_temp.as_postgres();
  delete from public.confession_declarations where user_id = pending_member_id and confession_id = confession_id_v;
  if row_count = 1 then
    perform pg_temp.cert_pass('032 confessions', 'pending member can still read their own confession declaration', row_count::text);
  else
    perform pg_temp.cert_fail('032 confessions', 'pending member can still read their own confession declaration', row_count::text);
  end if;

end $$;

select area, check_name, result, left(coalesce(evidence, ''), 90) as evidence from cert_results order by area, check_name;
select count(*) filter (where result = 'FAIL') as failures, count(*) as checks from cert_results;
rollback;
