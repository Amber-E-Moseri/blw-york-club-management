-- Leadership, role-assignment and active-only write certification (migrations 048-053).
--
-- Each check runs as the named account in its own authenticated session (request.jwt.claims + set local role).
-- Expected values: a read returns a row count; a write returns the affected row count; -1 means the statement
-- was refused with an error (guard trigger or RLS). A silent RLS no-op returns 0.
-- Transactional; a FAIL row is a regression.

begin;

create temporary table cert_results (area text not null, check_name text not null, result text not null, evidence text) on commit drop;
create temporary table fixture (actor text primary key, user_id uuid not null) on commit drop;

create or replace function pg_temp.run_stmt(actor_name text, stmt text, kind text) returns integer
language plpgsql as $$
declare
  uid uuid;
  f record;
  n integer := 0;
begin
  select user_id into uid from fixture where actor = actor_name;
  for f in select * from fixture loop
    stmt := replace(stmt, '{' || f.actor || '}', f.user_id::text);
  end loop;
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    if kind = 'read' then
      execute 'select count(*) from (' || stmt || ') s' into n;
    else
      execute stmt;
      get diagnostics n = row_count;
    end if;
  exception when others then
    n := -1;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return n;
end $$;

create or replace function pg_temp.check_count(area_name text, check_name text, actor_name text, stmt text, kind text, expected integer)
returns void language plpgsql as $$
declare
  got integer;
begin
  got := pg_temp.run_stmt(actor_name, stmt, kind);
  insert into cert_results values (area_name, check_name || ' [' || actor_name || ']',
    case when got = expected then 'PASS' else 'FAIL' end,
    case when got < 0 then 'refused' else got || ' (expected ' || expected || ')' end);
end $$;

-- 1. Accounts (profile rows are created by the auth.users trigger; status and role are set as the owner)
do $$
declare
  rec record;
  uid uuid;
begin
  for rec in select * from (values
    ('coord_active',      'coordinator', 'active'),
    ('lead_active',       'cell_leader', 'active'),
    ('lead_unassigned',   'cell_leader', 'active'),
    ('member_b_leader',   'member',      'active'),
    ('member_a',          'member',      'active'),
    ('member_b',          'member',      'active'),
    ('promote_target',    'member',      'active'),
    ('bsc_leader',        'member',      'active'),
    ('bsc_leader_rejected','member',     'active'),
    ('pending_target',    'member',      'pending'),
    ('rejected_user',     'member',      'rejected')
  ) v(actor, role, status) loop
    uid := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
      values (uid, rec.actor || '@leadership-cert.example.invalid', 'x', 'authenticated', 'authenticated', now(), now());
    update public.profiles set role = rec.role, status = rec.status where id = uid;
    insert into fixture values (rec.actor, uid);
  end loop;
end $$;

-- 2. Structure (as owner): two cells, two BSCs, cell membership by profile, meetings, one testimony
do $$
begin
  insert into public.cells (id, name) values
    ('00000000-0000-0000-0000-00000000ca01', 'cell A'),
    ('00000000-0000-0000-0000-00000000ca02', 'cell B');
  -- cell A is assigned to lead_active; cell B is assigned to member_b_leader (member role label)
  update public.cells set leader_id = (select user_id from fixture where actor = 'lead_active') where id = '00000000-0000-0000-0000-00000000ca01';
  update public.cells set leader_id = (select user_id from fixture where actor = 'member_b_leader') where id = '00000000-0000-0000-0000-00000000ca02';

  -- profile cell membership (does not, by itself, grant leadership)
  update public.profiles set cell_id = '00000000-0000-0000-0000-00000000ca01'
    where id in (select user_id from fixture where actor in ('lead_active', 'lead_unassigned', 'member_a'));
  -- bsc_leader and bsc_leader_rejected lead BSCs in cell B: they must have cell_id = ca02 so that
  -- guard_bsc_leader_eligibility (055) allows the BSC insert (trigger requires profiles.cell_id = bscs.cell_id).
  update public.profiles set cell_id = '00000000-0000-0000-0000-00000000ca02'
    where id in (select user_id from fixture where actor in ('member_b_leader', 'member_b', 'bsc_leader', 'bsc_leader_rejected'));

  insert into public.bscs (id, cell_id, name, leader_id) values
    ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000ca02', 'bsc one', (select user_id from fixture where actor = 'bsc_leader')),
    ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000ca02', 'bsc two', (select user_id from fixture where actor = 'bsc_leader_rejected'));
  update public.profiles set bsc_id = '00000000-0000-0000-0000-00000000bb01'
    where id = (select user_id from fixture where actor = 'member_b');

  insert into public.meetings (id, title, date, time, created_by, cell_id, visibility) values
    ('00000000-0000-0000-0000-00000000ee01', 'leaders A', current_date, '19:00', (select user_id from fixture where actor = 'coord_active'), '00000000-0000-0000-0000-00000000ca01', 'leaders'),
    ('00000000-0000-0000-0000-00000000ee02', 'leaders B', current_date, '19:00', (select user_id from fixture where actor = 'coord_active'), '00000000-0000-0000-0000-00000000ca02', 'leaders');

  insert into public.testimonies (id, author_id, author_name, title, body) values
    ('00000000-0000-0000-0000-00000000ee03', (select user_id from fixture where actor = 'member_a'), 'member a', 'seed', 'seed testimony body text');

  -- bsc_leader_rejected is assigned to bsc two, then rejected: it must lose BSC leadership at once
  update public.profiles set status = 'rejected' where id = (select user_id from fixture where actor = 'bsc_leader_rejected');
end $$;

-- 3. Role-assignment guard (048)
select pg_temp.check_count('role guard', 'coordinator cannot make a pending account an admin', 'coord_active',
  'update public.profiles set role = ''admin'' where id = ''{pending_target}''', 'write', -1);
select pg_temp.check_count('role guard', 'coordinator cannot make a rejected account a coordinator', 'coord_active',
  'update public.profiles set role = ''coordinator'' where id = ''{rejected_user}''', 'write', -1);
select pg_temp.check_count('role guard', 'coordinator can promote an active member to cell_leader', 'coord_active',
  'update public.profiles set role = ''cell_leader'' where id = ''{promote_target}''', 'write', 1);

-- 4. Leader-assignment guard (049): only an active account may be assigned as leader
select pg_temp.check_count('leader guard', 'pending account cannot be assigned as cell leader', 'coord_active',
  'update public.cells set leader_id = ''{pending_target}'' where id = ''00000000-0000-0000-0000-00000000ca02''', 'write', -1);
select pg_temp.check_count('leader guard', 'rejected account cannot be assigned as BSC leader', 'coord_active',
  'update public.bscs set leader_id = ''{rejected_user}'' where id = ''00000000-0000-0000-0000-00000000bb01''', 'write', -1);

-- 5. Cell leadership, profile reads (049): assignment, not profile cell or role label, decides
select pg_temp.check_count('cell leadership', 'assigned cell_leader reads a member of their cell', 'lead_active',
  'select id from public.profiles where id = ''{member_a}''', 'read', 1);
select pg_temp.check_count('cell leadership', 'assigned cell_leader cannot read a member of another cell', 'lead_active',
  'select id from public.profiles where id = ''{member_b}''', 'read', 0);
select pg_temp.check_count('cell leadership', 'cell_leader role with same cell but no assignment reads nothing (over-grant closed)', 'lead_unassigned',
  'select id from public.profiles where id = ''{member_a}''', 'read', 0);
-- Decision (054): assigned-cell leadership needs an active account and cells.leader_id, not the role label.
select pg_temp.check_count('cell leadership', 'assigned leader with member role label reads a member of their cell', 'member_b_leader',
  'select id from public.profiles where id = ''{member_b}''', 'read', 1);
select pg_temp.check_count('cell leadership', 'assigned leader with member role label reads no member of another cell', 'member_b_leader',
  'select id from public.profiles where id = ''{member_a}''', 'read', 0);
select pg_temp.check_count('cell leadership', 'member reads another member', 'member_a',
  'select id from public.profiles where id = ''{member_b}''', 'read', 0);
select pg_temp.check_count('cell leadership', 'member reads own profile', 'member_a',
  'select id from public.profiles where id = ''{member_a}''', 'read', 1);

-- 6. Leaders-only meetings (049)
select pg_temp.check_count('meetings', 'assigned leader reads leaders meeting of own cell', 'lead_active',
  'select id from public.meetings where id = ''00000000-0000-0000-0000-00000000ee01''', 'read', 1);
select pg_temp.check_count('meetings', 'assigned leader reads leaders meeting of another cell', 'lead_active',
  'select id from public.meetings where id = ''00000000-0000-0000-0000-00000000ee02''', 'read', 0);
select pg_temp.check_count('meetings', 'unassigned cell_leader reads no leaders meeting', 'lead_unassigned',
  'select id from public.meetings where visibility = ''leaders''', 'read', 0);
select pg_temp.check_count('meetings', 'member reads no leaders meeting', 'member_a',
  'select id from public.meetings where visibility = ''leaders''', 'read', 0);
select pg_temp.check_count('meetings', 'coordinator reads both leaders meetings', 'coord_active',
  'select id from public.meetings where visibility = ''leaders''', 'read', 2);

-- 7. BSC leadership (053): active and assigned
select pg_temp.check_count('bsc', 'active assigned BSC leader with member role has BSC authority', 'bsc_leader',
  'select 1 where public.is_bsc_leader_of(''00000000-0000-0000-0000-00000000bb01'')', 'read', 1);
select pg_temp.check_count('bsc', 'active BSC leader can view a member of their BSC', 'bsc_leader',
  'select 1 where public.can_view_member(''{member_b}'')', 'read', 1);
select pg_temp.check_count('bsc', 'rejected former BSC leader loses BSC authority', 'bsc_leader_rejected',
  'select 1 where public.is_bsc_leader_of(''00000000-0000-0000-0000-00000000bb02'')', 'read', 0);
select pg_temp.check_count('bsc', 'member of no BSC has no BSC authority', 'member_a',
  'select 1 where public.is_bsc_leader_of(''00000000-0000-0000-0000-00000000bb01'')', 'read', 0);

-- 8. Profile self-edit (051): active members edit ordinary fields only
select pg_temp.check_count('profile self-edit', 'active member edits own full name', 'member_a',
  'update public.profiles set full_name = ''Member A (edited)'' where id = ''{member_a}''', 'write', 1);
select pg_temp.check_count('profile self-edit', 'active member cannot grant own role', 'member_a',
  'update public.profiles set role = ''admin'' where id = ''{member_a}''', 'write', -1);
select pg_temp.check_count('profile self-edit', 'active member cannot move own cell', 'member_a',
  'update public.profiles set cell_id = ''00000000-0000-0000-0000-00000000ca02'' where id = ''{member_a}''', 'write', -1);
select pg_temp.check_count('profile self-edit', 'pending account edits own name (onboarding)', 'pending_target',
  'update public.profiles set full_name = ''Pending'' where id = ''{pending_target}''', 'write', 1);
select pg_temp.check_count('profile self-edit', 'rejected account cannot edit own profile', 'rejected_user',
  'update public.profiles set full_name = ''Rejected'' where id = ''{rejected_user}''', 'write', 0);

-- 9. Owner writes require an active account (050)
select pg_temp.check_count('owner writes', 'pending account cannot create a testimony', 'pending_target',
  'insert into public.testimonies (author_id, author_name, title, body) values (''{pending_target}'', ''p'', ''t'', ''testimony body text'')', 'write', -1);
select pg_temp.check_count('owner writes', 'rejected account cannot create a testimony', 'rejected_user',
  'insert into public.testimonies (author_id, author_name, title, body) values (''{rejected_user}'', ''r'', ''t'', ''testimony body text'')', 'write', -1);
select pg_temp.check_count('owner writes', 'active member creates a testimony', 'member_a',
  'insert into public.testimonies (author_id, author_name, title, body) values (''{member_a}'', ''a'', ''t'', ''testimony body text'')', 'write', 1);
select pg_temp.check_count('owner writes', 'pending account cannot delete another testimony', 'pending_target',
  'delete from public.testimonies where id = ''00000000-0000-0000-0000-00000000ee03''', 'write', 0);
select pg_temp.check_count('owner writes', 'active owner deletes own testimony', 'member_a',
  'delete from public.testimonies where id = ''00000000-0000-0000-0000-00000000ee03''', 'write', 1);

-- Decision (054): an assigned member-label leader gets the meetings of their own cell and no other.
select pg_temp.check_count('meetings', 'assigned member-label leader reads leaders meeting of own cell', 'member_b_leader',
  'select id from public.meetings where id = ''00000000-0000-0000-0000-00000000ee02''', 'read', 1);
select pg_temp.check_count('meetings', 'assigned member-label leader reads no leaders meeting of another cell', 'member_b_leader',
  'select id from public.meetings where id = ''00000000-0000-0000-0000-00000000ee01''', 'read', 0);
select pg_temp.check_count('meetings', 'assigned member-label leader may manage a meeting of own cell (update)', 'member_b_leader',
  'update public.meetings set title = title where id = ''00000000-0000-0000-0000-00000000ee02''', 'write', 1);
select pg_temp.check_count('meetings', 'assigned member-label leader may not manage a meeting of another cell', 'member_b_leader',
  'update public.meetings set title = title where id = ''00000000-0000-0000-0000-00000000ee01''', 'write', 0);
select pg_temp.check_count('meetings', 'unassigned cell_leader may not manage a leaders meeting', 'lead_unassigned',
  'update public.meetings set title = title where id = ''00000000-0000-0000-0000-00000000ee01''', 'write', 0);

-- Inactive assigned leader loses cell leadership at once (deactivated after the checks above).
do $$ begin update public.profiles set status = 'rejected' where id = (select user_id from fixture where actor = 'member_b_leader'); end $$;
select pg_temp.check_count('cell leadership', 'deactivated assigned leader reads no member of their cell', 'member_b_leader',
  'select id from public.profiles where id = ''{member_b}''', 'read', 0);
select pg_temp.check_count('meetings', 'deactivated assigned leader reads no leaders meeting of own cell', 'member_b_leader',
  'select id from public.meetings where id = ''00000000-0000-0000-0000-00000000ee02''', 'read', 0);

select area, check_name, result, evidence from cert_results order by area, check_name;
select count(*) filter (where result = 'FAIL') as failures, count(*) as checks from cert_results;
rollback;
