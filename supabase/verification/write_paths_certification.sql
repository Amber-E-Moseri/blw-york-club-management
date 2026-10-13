-- Write-path certification (076): saved groups, targeted affirmations and assignments, through the RPCs the UI calls.
-- Transactional; every check writes one PASS/FAIL row. Run with supabase/verification/run_sql_certification.mjs.

begin;

create temporary table cert_results (area text, check_name text, result text, evidence text) on commit drop;
grant all on cert_results to public;

create or replace function pg_temp.record(p_area text, p_name text, p_ok boolean, p_evidence text default null)
returns void language plpgsql as $$
begin
  insert into cert_results values (p_area, p_name, case when p_ok then 'PASS' else 'FAIL' end, p_evidence);
end $$;

create or replace function pg_temp.as_auth(p_user uuid)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;

-- Returns the SQLSTATE raised by the statement, or 'none'. The caller's role is restored by the caller.
create or replace function pg_temp.try(p_stmt text)
returns text language plpgsql as $$
begin
  execute p_stmt;
  return 'none';
exception when others then
  return sqlstate;
end $$;

do $$
declare
  coord_id uuid := gen_random_uuid();
  leader_a uuid := gen_random_uuid();
  leader_b uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();
  pend uuid := gen_random_uuid();
  cell_a uuid := gen_random_uuid();
  cell_b uuid := gen_random_uuid();
  cell_empty uuid := gen_random_uuid();
  v_group uuid;
  v_aff uuid;
  v_aff_all uuid;
  n integer;
  state text;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  select u, u::text || '@write-cert.invalid', 'x', 'authenticated', 'authenticated', now(), now()
  from unnest(array[coord_id, leader_a, leader_b, a1, a2, b1, pend]) u;

  insert into public.profiles (id, email, full_name, role, status, cell_id) values
    (coord_id, 'coord@write-cert.invalid', 'Coord', 'coordinator', 'active', null),
    (leader_a, 'la@write-cert.invalid', 'LA', 'cell_leader', 'active', null),
    (leader_b, 'lb@write-cert.invalid', 'LB', 'cell_leader', 'active', null),
    (a1, 'a1@write-cert.invalid', 'A1', 'member', 'active', null),
    (a2, 'a2@write-cert.invalid', 'A2', 'member', 'active', null),
    (b1, 'b1@write-cert.invalid', 'B1', 'member', 'active', null),
    (pend, 'p@write-cert.invalid', 'P', 'member', 'pending', null)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
    status = excluded.status, cell_id = excluded.cell_id;

  insert into public.cells (id, name, leader_id) values
    (cell_a, 'Write A', leader_a), (cell_b, 'Write B', leader_b), (cell_empty, 'Write Empty', null);
  update public.profiles set cell_id = cell_a where id in (a1, a2);
  update public.profiles set cell_id = cell_b where id = b1;

  -- Saved groups
  perform pg_temp.as_auth(a1);
  state := pg_temp.try(format('select public.create_saved_group(%L, array[%L]::uuid[])', 'Members', a2));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Saved groups', 'a member cannot create a saved group', state = '42501', state);

  perform pg_temp.as_auth(coord_id);
  select public.create_saved_group('Write group', array[a1, a2, a1]) into v_group;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Saved groups', 'a coordinator creates a group; duplicates collapse to two members',
    (select count(*) from public.saved_group_members where group_id = v_group) = 2, null);

  -- Targeted affirmation to a cell: spec, snapshot and row together
  perform pg_temp.as_auth(coord_id);
  select public.create_targeted_affirmation('Cell A word', 'Body', current_date, 'cells', array[cell_a]::uuid[])
    into v_aff;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Affirmations', 'a targeted affirmation stores its spec',
    (select audience_spec_id from public.confessions where id = v_aff) is not null, null);
  perform pg_temp.record('Affirmations', 'its frozen snapshot is exactly the active members of cell A',
    (select count(*) from public.audience_snapshots s join public.audience_publications p on p.id = s.publication_id
      where p.content_type = 'affirmation' and p.content_id = v_aff) = 2, null);

  -- Recipients can see it; a member of cell B cannot
  perform pg_temp.as_auth(a1);
  n := (select count(*) from public.confessions where id = v_aff);
  perform pg_temp.as_postgres();
  perform pg_temp.record('Affirmations', 'a cell A member sees the targeted affirmation', n = 1, n::text);
  perform pg_temp.as_auth(b1);
  n := (select count(*) from public.confessions where id = v_aff);
  perform pg_temp.as_postgres();
  perform pg_temp.record('Affirmations', 'a cell B member does not see it', n = 0, n::text);

  -- Broadcast: no spec, no snapshot
  perform pg_temp.as_auth(coord_id);
  select public.create_targeted_affirmation('All word', 'Body', current_date, 'all') into v_aff_all;
  perform pg_temp.as_postgres();
  perform pg_temp.record('Affirmations', 'mode all without exclusions is a broadcast (spec null)',
    (select audience_spec_id from public.confessions where id = v_aff_all) is null, null);

  -- Empty audience: refused, nothing saved
  perform pg_temp.as_auth(coord_id);
  state := pg_temp.try(format(
    $q$select public.create_targeted_affirmation('Empty', 'Body', current_date, 'cells', array[%L]::uuid[])$q$, cell_empty));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Affirmations', 'a cell with no active members is refused', state = '22023', state);
  perform pg_temp.record('Affirmations', 'the refused affirmation was not saved',
    (select count(*) from public.confessions where title = 'Empty') = 0, null);

  -- Leaders cannot publish affirmations (staff only)
  perform pg_temp.as_auth(leader_a);
  state := pg_temp.try(format(
    $q$select public.create_targeted_affirmation('Leader', 'Body', current_date, 'cells', array[%L]::uuid[])$q$, cell_a));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Affirmations', 'a cell leader cannot publish an affirmation', state = '42501', state);

  -- Assignments: a leader may assign only to members of their own cell
  perform pg_temp.as_auth(leader_a);
  state := pg_temp.try(format(
    $q$select * from public.create_assignments('Visit', null, current_date + 7, 'normal', array[%L]::uuid[])$q$, a1));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Assignments', 'a leader assigns to a member of their own cell', state = 'none', state);

  perform pg_temp.as_auth(leader_a);
  state := pg_temp.try(format(
    $q$select * from public.create_assignments('Visit', null, current_date + 7, 'normal', array[%L]::uuid[])$q$, b1));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Assignments', 'a leader cannot assign to a member of another cell', state = '42501', state);

  -- Atomic: one bad recipient rolls back the whole statement
  perform pg_temp.as_auth(leader_a);
  state := pg_temp.try(format(
    $q$select * from public.create_assignments('Batch', null, current_date, 'high', array[%L, %L]::uuid[])$q$, a2, b1));
  perform pg_temp.as_postgres();
  perform pg_temp.record('Assignments', 'a batch with one out-of-cell person saves nothing',
    (select count(*) from public.assignments where title = 'Batch') = 0, state);

  -- Coordinator assigns to two people; the assignee sees only their own row
  perform pg_temp.as_auth(coord_id);
  select count(*) into n from public.create_assignments('Coord task', 'Notes', current_date, 'normal', array[a1, a2]::uuid[]);
  perform pg_temp.as_postgres();
  perform pg_temp.record('Assignments', 'a coordinator assigns to two people in one call', n = 2, n::text);

  perform pg_temp.as_auth(a1);
  n := (select count(*) from public.assignments where title = 'Coord task');
  perform pg_temp.as_postgres();
  perform pg_temp.record('Assignments', 'an assignee reads their own assignment', n = 1, n::text);

  perform pg_temp.as_auth(b1);
  n := (select count(*) from public.assignments where title = 'Coord task');
  perform pg_temp.as_postgres();
  perform pg_temp.record('Assignments', 'a member of another cell cannot read it', n = 0, n::text);
end $$;

select area, check_name, result, evidence from cert_results order by area, check_name;
select count(*) filter (where result = 'FAIL') as failures, count(*) as checks from cert_results;

rollback;
