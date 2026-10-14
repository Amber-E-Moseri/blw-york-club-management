-- Cell administration certification (072). Transactional; every check writes one PASS/FAIL row.
begin;
create temporary table cert_results (area text, check_name text, result text, evidence text) on commit drop;
grant all on cert_results to public;
create or replace function pg_temp.record(p_area text, p_name text, p_ok boolean, p_evidence text default null)
returns void language plpgsql as $$
begin insert into cert_results values (p_area, p_name, case when p_ok then 'PASS' else 'FAIL' end, p_evidence); end $$;
create or replace function pg_temp.as_auth(p_user uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;
create or replace function pg_temp.try(p_stmt text) returns text language plpgsql as $$
begin execute p_stmt; return 'none'; exception when others then return sqlstate; end $$;

do $$
declare
  admin_id uuid := gen_random_uuid(); coord_id uuid := gen_random_uuid();
  leader_a uuid := gen_random_uuid(); leader_b uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); pend uuid := gen_random_uuid();
  cell_a uuid := gen_random_uuid(); cell_b uuid := gen_random_uuid(); cell_empty uuid := gen_random_uuid();
  n integer; state text; v_audit_before integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  select u, u::text || '@cell-cert.invalid', 'x', 'authenticated', 'authenticated', now(), now()
  from unnest(array[admin_id, coord_id, leader_a, leader_b, m1, m2, pend]) u;
  insert into public.profiles (id, email, full_name, role, status, cell_id) values
    (admin_id, 'admin@cell-cert.invalid', 'Admin', 'admin', 'active', null),
    (coord_id, 'coord@cell-cert.invalid', 'Coord', 'coordinator', 'active', null),
    (leader_a, 'la@cell-cert.invalid', 'LA', 'cell_leader', 'active', null),
    (leader_b, 'lb@cell-cert.invalid', 'LB', 'cell_leader', 'active', null),
    (m1, 'm1@cell-cert.invalid', 'M1', 'member', 'active', null),
    (m2, 'm2@cell-cert.invalid', 'M2', 'member', 'active', null),
    (pend, 'p@cell-cert.invalid', 'P', 'member', 'pending', null)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, status = excluded.status, cell_id = excluded.cell_id;
  insert into public.cells (id, name) values (cell_a, 'Cell A'), (cell_b, 'Cell B'), (cell_empty, 'Empty');
  update public.cells set leader_id = leader_a where id = cell_a;

  -- Placement: only active members, only into live cells.
  perform set_config('app.cell_change_reason', 'owner fixture setup', false);
  state := pg_temp.try(format('update public.profiles set cell_id = %L where id = %L', cell_a, pend));
  perform pg_temp.record('Placement', 'a pending account cannot be placed in a cell', state = 'P0001', state);
  perform set_config('app.cell_change_reason', 'owner fixture setup', false);
  update public.profiles set cell_id = cell_a where id = m1;
  perform pg_temp.record('Placement', 'an active member can be placed in a cell (owner setup)', (select cell_id from public.profiles where id = m1) = cell_a, null);

  -- Authority: a member cannot rename a cell (RLS hides the row, so nothing changes).
  perform pg_temp.as_auth(m1);
  state := pg_temp.try(format('update public.cells set name = %L where id = %L', 'Hacked', cell_b));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Authority', 'a member cannot rename a cell', (select name from public.cells where id = cell_b) = 'Cell B', state);

  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format('update public.cells set name = %L where id = %L', 'Cell B2', cell_b));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Authority', 'a coordinator can rename a cell', (select name from public.cells where id = cell_b) = 'Cell B2', state);

  perform pg_temp.record('Audit', 'the rename is recorded in cell_admin_audit', exists(
    select 1 from public.cell_admin_audit where cell_id = cell_b and action = 'update'), null);

  -- Delete and archive safeguards.
  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format('delete from public.cells where id = %L', cell_a));
  perform pg_temp.record('Lifecycle', 'a cell with members cannot be deleted', state = 'P0001', state);
  state := pg_temp.try(format('update public.cells set archived_at = now() where id = %L', cell_a));
  perform pg_temp.record('Lifecycle', 'a cell with members cannot be archived', state = 'P0001', state);
  state := pg_temp.try(format('update public.cells set archived_at = now() where id = %L', cell_empty));
  perform pg_temp.record('Lifecycle', 'an empty cell can be archived', state = 'none', state);
  state := pg_temp.try(format('update public.cells set leader_id = %L where id = %L', leader_b, cell_empty));
  perform pg_temp.record('Lifecycle', 'an archived cell cannot be given a leader', state = 'P0001', state);
  perform pg_temp.as_postgres();
  perform set_config('app.cell_change_reason', 'owner fixture setup', false);
  state := pg_temp.try(format('update public.profiles set cell_id = %L where id = %L', cell_empty, m2));
  perform pg_temp.record('Placement', 'no member can be placed into an archived cell', state = 'P0001', state);

  -- Audited transfer RPC.
  perform pg_temp.as_auth(m1);
  state := pg_temp.try(format('select * from public.transfer_member_cell(%L, %L, %L)', m2, cell_b, 'Fixture transfer'));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Transfer', 'a member cannot call transfer_member_cell', state = '42501', state);

  select count(*) into v_audit_before from public.member_cell_audit where member_id = m1;
  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format('select * from public.transfer_member_cell(%L, %L, %L)', m1, cell_b, 'Fixture transfer'));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Transfer', 'a coordinator can move an active member between cells', state = 'none', state);
  perform pg_temp.record('Transfer', 'the move is recorded in member_cell_audit',
    (select count(*) from public.member_cell_audit where member_id = m1) > v_audit_before, null);

  -- A cell leader cannot be moved until leadership is reassigned.
  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format('select * from public.transfer_member_cell(%L, %L, %L)', leader_a, cell_b, 'Fixture transfer'));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Transfer', 'a cell leader cannot be moved while leading', state = 'P0001', state);

  -- Deactivation releases the cell the person leads.
  update public.profiles set status = 'inactive' where id = leader_a;
  perform pg_temp.record('Deactivation', 'deactivating a leader releases their cell',
    (select leader_id from public.cells where id = cell_a) is null, null);
end $$;

select area, check_name, result, evidence from cert_results order by area, check_name;
select count(*) filter (where result = 'FAIL') as failures, count(*) as checks from cert_results;
rollback;
