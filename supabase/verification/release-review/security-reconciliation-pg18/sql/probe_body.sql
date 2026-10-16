-- ── Audience fixtures (owner). Two private audiences: a cells audience for C1, and an explicit audience with one invitee (M1).
insert into public.audience_specs (id, mode, cell_ids, created_by) values
  ('aa000000-0000-0000-0000-000000000001', 'cells', array['c1000000-0000-0000-0000-000000000001']::uuid[], '00000000-0000-0000-0000-00000000a001');
insert into public.audience_specs (id, mode, profile_ids, created_by) values
  ('aa000000-0000-0000-0000-000000000002', 'explicit', array['00000000-0000-0000-0000-00000000d001']::uuid[], '00000000-0000-0000-0000-00000000a001');
insert into public.audience_publications (id, content_id, content_type, recipient_count, spec_id, published_by) values
  ('ab000000-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000002', 'announcement', 1, 'aa000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000a001');
insert into public.audience_snapshots (profile_id, publication_id) values
  ('00000000-0000-0000-0000-00000000d001', 'ab000000-0000-0000-0000-000000000002');

\echo ===== 1. AUDIENCE TABLE VISIBILITY =====
select rls_test.probe_rows('audience_specs: ordinary non-manager M3', '00000000-0000-0000-0000-00000000d003', 'select id from public.audience_specs');
select rls_test.probe_rows('audience_specs: meeting invitee M1 (explicit invitee of spec 0002)', '00000000-0000-0000-0000-00000000d001', 'select id from public.audience_specs');
select rls_test.probe_rows('audience_specs: cell leader CL1 (leader of C1)', '00000000-0000-0000-0000-00000000f001', 'select id from public.audience_specs');
select rls_test.probe_rows('audience_specs: administrator AD', '00000000-0000-0000-0000-00000000a001', 'select id from public.audience_specs');
select rls_test.probe_rows('audience_specs: coordinator CO', '00000000-0000-0000-0000-00000000c001', 'select id from public.audience_specs');
select rls_test.probe_rows('audience_snapshots: ordinary non-manager M3', '00000000-0000-0000-0000-00000000d003', 'select profile_id, publication_id from public.audience_snapshots');
select rls_test.probe_rows('audience_snapshots: invitee M1 (his own snapshot row)', '00000000-0000-0000-0000-00000000d001', 'select profile_id, publication_id from public.audience_snapshots');
select rls_test.probe_rows('audience_snapshots: cell leader CL1', '00000000-0000-0000-0000-00000000f001', 'select profile_id, publication_id from public.audience_snapshots');
select rls_test.probe_rows('audience_snapshots: administrator AD', '00000000-0000-0000-0000-00000000a001', 'select profile_id, publication_id from public.audience_snapshots');
select rls_test.probe_rows('audience_snapshots: coordinator CO', '00000000-0000-0000-0000-00000000c001', 'select profile_id, publication_id from public.audience_snapshots');
select rls_test.probe_rows('audience_snapshots: anonymous (no JWT sub, role anon)', null, 'select profile_id from public.audience_snapshots');

\echo ===== 2. A1 PROFILE VISIBILITY (cell leader CL1, cell C1) =====
select rls_test.probe_list('A1: C1 profiles visible to CL1 (excluding self)', '00000000-0000-0000-0000-00000000f001', 'select p.full_name || ''|'' || p.status from public.profiles p where p.cell_id = ''c1000000-0000-0000-0000-000000000001'' and p.id <> ''00000000-0000-0000-0000-00000000f001''');
select rls_test.probe_list('A1: C1 profiles that exist (owner view, excluding CL1)', null, 'select p.full_name || ''|'' || p.status from public.profiles p where p.cell_id = ''c1000000-0000-0000-0000-000000000001'' and p.id <> ''00000000-0000-0000-0000-00000000f001''');

\echo ===== 3. SIX PRIVILEGE REFUSALS: refusal and side effects =====
select rls_test.probe_write('B10 BL1 move own profile cell', '00000000-0000-0000-0000-00000000b001', $q$update public.profiles set cell_id = 'c1000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-00000000b001'$q$, 'profiles', '00000000-0000-0000-0000-00000000b001');
select rls_test.probe_write('D11 M1 write BSC field', '00000000-0000-0000-0000-00000000d001', $q$update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-00000000d001'$q$, 'profiles', '00000000-0000-0000-0000-00000000d001');
select rls_test.probe_write('D12 AD set BSC on M2 (expect zero rows)', '00000000-0000-0000-0000-00000000a001', $q$update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000d002'$q$, 'profiles', '00000000-0000-0000-0000-00000000d002');
select rls_test.probe_write('D14 AD clear cell of M3 (expect zero rows)', '00000000-0000-0000-0000-00000000a001', $q$update public.profiles set cell_id = null where id = '00000000-0000-0000-0000-00000000d003'$q$, 'profiles', '00000000-0000-0000-0000-00000000d003');
select rls_test.probe_write('F1 M1 change own cell', '00000000-0000-0000-0000-00000000d001', $q$update public.profiles set cell_id = 'c1000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-00000000d001'$q$, 'profiles', '00000000-0000-0000-0000-00000000d001');
select rls_test.probe_write('F2 M1 activate MP (expect zero rows)', '00000000-0000-0000-0000-00000000d001', $q$update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000d004'$q$, 'profiles', '00000000-0000-0000-0000-00000000d004');
