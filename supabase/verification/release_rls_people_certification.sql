begin;

create temporary table cert_results (
  area text not null,
  check_name text not null,
  result text not null,
  evidence text
) on commit drop;

create or replace function pg_temp.cert_pass(area text, check_name text, evidence text default null)
returns void language plpgsql security definer as $$
begin
  insert into cert_results values (area, check_name, 'PASS', evidence);
end $$;

create or replace function pg_temp.cert_fail(area text, check_name text, evidence text)
returns void language plpgsql security definer as $$
begin
  insert into cert_results values (area, check_name, 'FAIL', evidence);
end $$;

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
  member_id uuid := '10000000-0000-0000-0000-000000000101';
  leader_a_id uuid := '10000000-0000-0000-0000-000000000102';
  leader_b_id uuid := '10000000-0000-0000-0000-000000000103';
  admin_id uuid := '10000000-0000-0000-0000-000000000104';
  coord_id uuid := '10000000-0000-0000-0000-000000000105';
  custom_id uuid := '10000000-0000-0000-0000-000000000106';
  pending_id uuid := '10000000-0000-0000-0000-000000000107';
  rejected_id uuid := '10000000-0000-0000-0000-000000000108';
  cell_a uuid;
  cell_b uuid;
  event_id uuid;
  meeting_a uuid;
  meeting_b uuid;
  person_contact uuid;
  person_existing uuid;
  person_rejected uuid;
  merge_target uuid;
  merge_source uuid;
  contact_a uuid;
  contact_b uuid;
  custom_role uuid;
  visible_count integer;
  same_person_count integer;
  transition_count integer;
  observed_text text;
  observed_uuid uuid;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  values
    (member_id, 'cert.member@example.test', 'x', 'authenticated', 'authenticated', now(), now()),
    (leader_a_id, 'cert.leader.a@example.test', 'x', 'authenticated', 'authenticated', now(), now()),
    (leader_b_id, 'cert.leader.b@example.test', 'x', 'authenticated', 'authenticated', now(), now()),
    (admin_id, 'cert.admin@example.test', 'x', 'authenticated', 'authenticated', now(), now()),
    (coord_id, 'cert.coord@example.test', 'x', 'authenticated', 'authenticated', now(), now()),
    (custom_id, 'cert.custom@example.test', 'x', 'authenticated', 'authenticated', now(), now()),
    (pending_id, 'cert.pending@example.test', 'x', 'authenticated', 'authenticated', now(), now()),
    (rejected_id, 'cert.rejected@example.test', 'x', 'authenticated', 'authenticated', now(), now());

  insert into public.people (full_name, email, phone) values
    ('Cert Member', 'cert.member@example.test', '+14165550101'),
    ('Cert Leader A', 'cert.leader.a@example.test', '+14165550102'),
    ('Cert Leader B', 'cert.leader.b@example.test', '+14165550103'),
    ('Cert Admin', 'cert.admin@example.test', '+14165550104'),
    ('Cert Coordinator', 'cert.coord@example.test', '+14165550105'),
    ('Cert Custom', 'cert.custom@example.test', '+14165550106'),
    ('Cert Pending', 'cert.pending@example.test', '+14165550107'),
    ('Cert Rejected', 'cert.rejected@example.test', '+14165550108')
  on conflict do nothing;

  insert into public.profiles (id, email, full_name, role, status, person_id)
  select member_id, 'cert.member@example.test', 'Cert Member', 'member', 'active', id from public.people where email = 'cert.member@example.test'
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, person_id = excluded.person_id;
  insert into public.profiles (id, email, full_name, role, status, person_id)
  select leader_a_id, 'cert.leader.a@example.test', 'Cert Leader A', 'cell_leader', 'active', id from public.people where email = 'cert.leader.a@example.test'
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, person_id = excluded.person_id;
  insert into public.profiles (id, email, full_name, role, status, person_id)
  select leader_b_id, 'cert.leader.b@example.test', 'Cert Leader B', 'cell_leader', 'active', id from public.people where email = 'cert.leader.b@example.test'
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, person_id = excluded.person_id;
  insert into public.profiles (id, email, full_name, role, status, person_id)
  select admin_id, 'cert.admin@example.test', 'Cert Admin', 'admin', 'active', id from public.people where email = 'cert.admin@example.test'
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, person_id = excluded.person_id;
  insert into public.profiles (id, email, full_name, role, status, person_id)
  select coord_id, 'cert.coord@example.test', 'Cert Coordinator', 'coordinator', 'active', id from public.people where email = 'cert.coord@example.test'
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, person_id = excluded.person_id;
  insert into public.profiles (id, email, full_name, role, status, person_id)
  select custom_id, 'cert.custom@example.test', 'Cert Custom', 'member', 'active', id from public.people where email = 'cert.custom@example.test'
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, person_id = excluded.person_id;
  insert into public.profiles (id, email, full_name, role, status, person_id)
  select pending_id, 'cert.pending@example.test', 'Cert Pending', 'member', 'pending', id from public.people where email = 'cert.pending@example.test'
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, person_id = excluded.person_id;
  insert into public.profiles (id, email, full_name, role, status, person_id)
  select rejected_id, 'cert.rejected@example.test', 'Cert Rejected', 'member', 'rejected', id from public.people where email = 'cert.rejected@example.test'
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, status = excluded.status, person_id = excluded.person_id;

  insert into public.cells (name, leader_id) values ('Cert Cell A', leader_a_id) returning id into cell_a;
  insert into public.cells (name, leader_id) values ('Cert Cell B', leader_b_id) returning id into cell_b;
  update public.profiles set cell_id = cell_a where id in (member_id, leader_a_id, custom_id);
  update public.profiles set cell_id = cell_b where id = leader_b_id;

  insert into public.events (title, date, time, category, created_by)
  values ('Cert Event', current_date + 7, '19:00', 'Other', admin_id)
  returning id into event_id;

  insert into public.meetings (title, date, time, visibility, cell_id, created_by, category)
  values ('Cert Meeting A', current_date + 1, '18:00', 'cell', cell_a, leader_a_id, 'cell')
  returning id into meeting_a;
  insert into public.meetings (title, date, time, visibility, cell_id, created_by, category)
  values ('Cert Meeting B', current_date + 1, '18:00', 'cell', cell_b, leader_b_id, 'cell')
  returning id into meeting_b;

  insert into public.zoom_attendance (meeting_id, zoom_participant_id, participant_name, participant_email, member_id, join_time, leave_time, duration_minutes)
  values
    (meeting_a, 'cert-zoom-a', 'Cert Member', 'cert.member@example.test', member_id, now(), now() + interval '30 minutes', 30),
    (meeting_b, 'cert-zoom-b', 'Cert Leader B', 'cert.leader.b@example.test', leader_b_id, now(), now() + interval '30 minutes', 30);

  insert into public.people (full_name, email, phone) values ('Cert Outreach Human', 'cert.outreach@example.test', '+14165550999') returning id into person_contact;
  insert into public.contacts (person_id, contact_name, contact_phone, email, cell_id, logged_by, follow_up_status, notes)
  values (person_contact, 'Cert Outreach Human', '+14165550999', 'cert.outreach@example.test', cell_a, leader_a_id, 'new', 'initial outreach')
  returning id into contact_a;

  insert into public.people (full_name, email, phone) values ('Cert Cell B Contact', 'cert.cellb@example.test', '+14165550888') returning id into person_existing;
  insert into public.contacts (person_id, contact_name, contact_phone, email, cell_id, logged_by, follow_up_status)
  values (person_existing, 'Cert Cell B Contact', '+14165550888', 'cert.cellb@example.test', cell_b, leader_b_id, 'new')
  returning id into contact_b;

  insert into public.admin_roles (name, description, created_by) values ('Cert Reports Role', 'local certification', coord_id) returning id into custom_role;
  insert into public.admin_role_permissions (role_id, permission_key) values (custom_role, 'reports.generate');
  insert into public.admin_role_assignments (role_id, user_id, assigned_by) values (custom_role, custom_id, coord_id);

  begin
    perform pg_temp.as_auth(member_id);
    update public.profiles set role = 'coordinator' where id = member_id;
    perform pg_temp.as_postgres();
    select role into observed_text from public.profiles where id = member_id;
    if observed_text = 'member' then
      perform pg_temp.cert_pass('Member RLS', 'member cannot update own role', 'role remained member');
    else
      perform pg_temp.cert_fail('Member RLS', 'member cannot update own role', 'role changed to ' || observed_text);
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot update own role', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(member_id);
    update public.profiles set status = 'rejected' where id = member_id;
    perform pg_temp.as_postgres();
    select status into observed_text from public.profiles where id = member_id;
    if observed_text = 'active' then
      perform pg_temp.cert_pass('Member RLS', 'member cannot update own status', 'status remained active');
    else
      perform pg_temp.cert_fail('Member RLS', 'member cannot update own status', 'status changed to ' || observed_text);
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot update own status', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(member_id);
    update public.profiles set admin_role = 'superuser' where id = member_id;
    perform pg_temp.as_postgres();
    select admin_role into observed_text from public.profiles where id = member_id;
    if observed_text is null then
      perform pg_temp.cert_pass('Member RLS', 'member cannot update own admin_role', 'admin_role remained null');
    else
      perform pg_temp.cert_fail('Member RLS', 'member cannot update own admin_role', 'admin_role changed to ' || observed_text);
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot update own admin_role', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(member_id);
    update public.profiles set cell_id = cell_b where id = member_id;
    perform pg_temp.as_postgres();
    select cell_id into observed_uuid from public.profiles where id = member_id;
    if observed_uuid = cell_a then
      perform pg_temp.cert_pass('Member RLS', 'member cannot reassign own cell', 'cell_id remained Cell A');
    else
      perform pg_temp.cert_fail('Member RLS', 'member cannot reassign own cell', 'cell_id changed');
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot reassign own cell', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(member_id);
    perform public.approve_pending_member(pending_id);
    perform pg_temp.cert_fail('Member RLS', 'member cannot approve pending member', 'rpc unexpectedly succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot approve pending member', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(member_id);
    perform public.reject_pending_member(pending_id);
    perform pg_temp.cert_fail('Member RLS', 'member cannot reject pending member', 'rpc unexpectedly succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot reject pending member', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(member_id);
    perform public.export_members_authorized('all');
    perform pg_temp.cert_fail('Member RLS', 'member cannot export sensitive members', 'export unexpectedly succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot export sensitive members', sqlerrm);
  end;

  perform pg_temp.as_auth(member_id);
  select count(*) into visible_count from public.profiles where id in (leader_b_id, admin_id, coord_id);
  perform pg_temp.as_postgres();
  if visible_count = 0 then
    perform pg_temp.cert_pass('Member RLS', 'member cannot read unrelated private profiles', 'visible unrelated profiles=0');
  else
    perform pg_temp.cert_fail('Member RLS', 'member cannot read unrelated private profiles', 'visible unrelated profiles=' || visible_count);
  end if;

  begin
    perform pg_temp.as_auth(member_id);
    insert into public.contacts (person_id, contact_name, cell_id, logged_by)
    values (person_contact, 'Member Bad Contact', cell_b, member_id);
    perform pg_temp.cert_fail('Member RLS', 'member cannot globally mutate contacts', 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot globally mutate contacts', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(member_id);
    insert into public.meetings (title, date, time, visibility, cell_id, created_by, category)
    values ('Member Bad Meeting', current_date, '12:00', 'cell', cell_b, member_id, 'cell');
    perform pg_temp.cert_fail('Member RLS', 'member cannot manage unrelated meeting', 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member cannot manage unrelated meeting', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(member_id);
    insert into public.event_rsvps (event_id, user_id) values (event_id, member_id);
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Member RLS', 'member can RSVP to event', 'own RSVP row inserted');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('Member RLS', 'member can RSVP to event', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(leader_a_id);
    update public.profiles set role = 'coordinator' where id = leader_a_id;
    perform pg_temp.as_postgres();
    select role into observed_text from public.profiles where id = leader_a_id;
    if observed_text = 'cell_leader' then
      perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot promote self', 'role remained cell_leader');
    else
      perform pg_temp.cert_fail('Cell Leader RLS', 'leader A cannot promote self', 'role changed to ' || observed_text);
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot promote self', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(leader_a_id);
    update public.profiles set role = 'admin' where id = member_id;
    perform pg_temp.as_postgres();
    select role into observed_text from public.profiles where id = member_id;
    if observed_text = 'member' then
      perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot promote another user', 'target role remained member');
    else
      perform pg_temp.cert_fail('Cell Leader RLS', 'leader A cannot promote another user', 'target role changed to ' || observed_text);
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot promote another user', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(leader_a_id);
    update public.contacts set notes = 'leader A scoped update' where id = contact_a;
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Cell Leader RLS', 'leader A can update Cell A contact', 'scoped update accepted');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('Cell Leader RLS', 'leader A can update Cell A contact', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(leader_a_id);
    update public.contacts set notes = 'leader A cross-cell update' where id = contact_b;
    if found then
      perform pg_temp.cert_fail('Cell Leader RLS', 'leader A cannot mutate Cell B contact', 'cross-cell update affected a row');
    else
      perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot mutate Cell B contact', 'cross-cell update affected 0 rows');
    end if;
    perform pg_temp.as_postgres();
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot mutate Cell B contact', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(leader_a_id);
    update public.meetings set title = 'Cert Meeting A Updated' where id = meeting_a;
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Cell Leader RLS', 'leader A can manage Cell A meeting', 'scoped meeting update accepted');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('Cell Leader RLS', 'leader A can manage Cell A meeting', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(leader_a_id);
    update public.meetings set title = 'Bad Cross Cell Meeting' where id = meeting_b;
    if found then
      perform pg_temp.cert_fail('Cell Leader RLS', 'leader A cannot manage Cell B meeting', 'cross-cell update affected a row');
    else
      perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot manage Cell B meeting', 'cross-cell update affected 0 rows');
    end if;
    perform pg_temp.as_postgres();
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot manage Cell B meeting', sqlerrm);
  end;

  perform pg_temp.as_auth(leader_a_id);
  select count(*) into visible_count from public.zoom_attendance where meeting_id = meeting_b;
  perform pg_temp.as_postgres();
  if visible_count = 0 then
    perform pg_temp.cert_pass('Cell Leader RLS', 'leader A cannot read Cell B Zoom attendance', 'visible rows=0');
  else
    perform pg_temp.cert_fail('Cell Leader RLS', 'leader A cannot read Cell B Zoom attendance', 'visible rows=' || visible_count);
  end if;

  begin
    perform pg_temp.as_auth(leader_b_id);
    update public.contacts set notes = 'leader B cross-cell update' where id = contact_a;
    if found then
      perform pg_temp.cert_fail('Cell Leader RLS', 'leader B cannot mutate Cell A contact', 'cross-cell update affected a row');
    else
      perform pg_temp.cert_pass('Cell Leader RLS', 'leader B cannot mutate Cell A contact', 'cross-cell update affected 0 rows');
    end if;
    perform pg_temp.as_postgres();
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Cell Leader RLS', 'leader B cannot mutate Cell A contact', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(admin_id);
    perform public.approve_pending_member(pending_id);
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Admin RLS', 'admin can approve pending member', 'approval RPC accepted');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('Admin RLS', 'admin can approve pending member', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(admin_id);
    insert into public.admin_roles (name, description, created_by) values ('Cert Bad Admin Role', 'should fail', admin_id);
    perform pg_temp.cert_fail('Admin RLS', 'admin cannot manage coordinator-only admin roles', 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Admin RLS', 'admin cannot manage coordinator-only admin roles', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(coord_id);
    insert into public.admin_roles (name, description, created_by) values ('Cert Coordinator Role', 'allowed', coord_id);
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Coordinator RLS', 'coordinator can manage admin roles', 'insert accepted');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('Coordinator RLS', 'coordinator can manage admin roles', sqlerrm);
  end;

  perform pg_temp.as_auth(custom_id);
  if public.has_admin_permission('reports.generate') then
    perform pg_temp.cert_pass('Custom Permissions', 'custom reports permission present allows permission check', 'reports.generate=true');
  else
    perform pg_temp.cert_fail('Custom Permissions', 'custom reports permission present allows permission check', 'reports.generate=false');
  end if;
  if not public.has_admin_permission('notifications.send') then
    perform pg_temp.cert_pass('Custom Permissions', 'absent custom permission is denied', 'notifications.send=false');
  else
    perform pg_temp.cert_fail('Custom Permissions', 'absent custom permission is denied', 'notifications.send=true');
  end if;
  perform pg_temp.as_postgres();

  begin
    perform pg_temp.as_auth(custom_id);
    perform public.export_members_authorized('active');
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('Custom Permissions', 'custom reports permission allows export RPC', 'export RPC accepted');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('Custom Permissions', 'custom reports permission allows export RPC', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(admin_id);
    insert into public.memberships (person_id, status, role, cell_id) values (person_contact, 'pending', 'member', cell_a);
    select count(*) into same_person_count from public.memberships where person_id = person_contact and status = 'pending';
    perform pg_temp.as_postgres();
    if same_person_count = 1 then
      perform pg_temp.cert_pass('People Lifecycle', 'contact to pending member keeps same person', 'pending memberships for person=1');
    else
      perform pg_temp.cert_fail('People Lifecycle', 'contact to pending member keeps same person', 'pending memberships=' || same_person_count);
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('People Lifecycle', 'contact to pending member keeps same person', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(admin_id);
    update public.memberships set status = 'active' where person_id = person_contact and status = 'pending';
    insert into public.membership_transitions (person_id, from_type, to_type, performed_by, notes)
    values (person_contact, 'pending', 'active', admin_id, 'cert approval');
    select count(*) into transition_count from public.contacts where person_id = person_contact;
    perform pg_temp.as_postgres();
    if transition_count = 1 then
      perform pg_temp.cert_pass('People Lifecycle', 'approval preserves outreach history', 'contacts still attached=1');
    else
      perform pg_temp.cert_fail('People Lifecycle', 'approval preserves outreach history', 'contacts attached=' || transition_count);
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('People Lifecycle', 'approval preserves outreach history', sqlerrm);
  end;

  insert into public.people (full_name, email, phone) values ('Cert Reject/Reapply', 'cert.reject-reapply@example.test', '+14165550777') returning id into person_rejected;
  begin
    perform pg_temp.as_auth(admin_id);
    insert into public.memberships (person_id, status, role, cell_id) values (person_rejected, 'pending', 'member', cell_a);
    update public.memberships set status = 'rejected' where person_id = person_rejected and status = 'pending';
    insert into public.memberships (person_id, status, role, cell_id) values (person_rejected, 'pending', 'member', cell_a);
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('People Lifecycle', 'rejected person can reapply without duplicate human', 'same person has rejected and pending membership history');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('People Lifecycle', 'rejected person can reapply without duplicate human', sqlerrm);
  end;

  begin
    insert into public.people (full_name, email) values ('Cert Duplicate Email', 'CERT.OUTREACH@EXAMPLE.TEST');
    perform pg_temp.cert_fail('People Lifecycle', 'normalized duplicate email is blocked', 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.cert_pass('People Lifecycle', 'normalized duplicate email is blocked', sqlerrm);
  end;

  begin
    insert into public.people (full_name, phone) values ('Cert Duplicate Phone', '+1 416 555 0999');
    perform pg_temp.cert_fail('People Lifecycle', 'normalized duplicate phone is blocked', 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.cert_pass('People Lifecycle', 'normalized duplicate phone is blocked', sqlerrm);
  end;

  begin
    insert into public.people (full_name) values ('Cert Same Name'), ('Cert Same Name');
    perform pg_temp.cert_pass('People Lifecycle', 'same name different people remains possible', 'two rows with same name and no identity inserted');
  exception when others then
    perform pg_temp.cert_fail('People Lifecycle', 'same name different people remains possible', sqlerrm);
  end;

  insert into public.people (full_name, email) values ('Cert Merge Target', 'cert.merge.target@example.test') returning id into merge_target;
  insert into public.people (full_name, email) values ('Cert Merge Source', 'cert.merge.source@example.test') returning id into merge_source;
  insert into public.contacts (person_id, contact_name, email, cell_id, logged_by, notes)
  values (merge_source, 'Cert Merge Source', 'cert.merge.source@example.test', cell_a, leader_a_id, 'merge source history');
  insert into public.membership_transitions (person_id, from_type, to_type, performed_by, notes)
  values (merge_source, 'contact', 'pending', admin_id, 'source history');

  begin
    perform pg_temp.as_auth(member_id);
    perform public.merge_people(merge_target, merge_source, 'member should fail');
    perform pg_temp.cert_fail('People Lifecycle', 'unauthorized merge_people fails', 'merge unexpectedly succeeded');
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_pass('People Lifecycle', 'unauthorized merge_people fails', sqlerrm);
  end;

  begin
    perform pg_temp.as_auth(admin_id);
    perform public.merge_people(merge_target, merge_source, 'authorized cert merge');
    select count(*) into same_person_count from public.contacts where person_id = merge_target and notes = 'merge source history';
    select count(*) into transition_count from public.membership_transitions where person_id = merge_target;
    perform pg_temp.as_postgres();
    if same_person_count = 1 and transition_count >= 2 then
      perform pg_temp.cert_pass('People Lifecycle', 'authorized merge repoints relationships and preserves history', 'contacts=' || same_person_count || ', transitions=' || transition_count);
    else
      perform pg_temp.cert_fail('People Lifecycle', 'authorized merge repoints relationships and preserves history', 'contacts=' || same_person_count || ', transitions=' || transition_count);
    end if;
  exception when others then
    perform pg_temp.as_postgres();
    perform pg_temp.cert_fail('People Lifecycle', 'authorized merge repoints relationships and preserves history', sqlerrm);
  end;
end $$;

select area, check_name, result, evidence
from cert_results
order by area, check_name;

do $$
declare
  failures integer;
begin
  select count(*) into failures from cert_results where result <> 'PASS';
  if failures > 0 then
    raise exception 'release RLS/People certification failed: % failing checks', failures;
  end if;
end $$;

rollback;
