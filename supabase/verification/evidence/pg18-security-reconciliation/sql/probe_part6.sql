\echo ===== 8. REJECTED PROFILE VISIBILITY (MR = d005 rejected, cell C1) =====
select rls_test.probe_rows('profiles: ordinary member M3, rejected rows', '00000000-0000-0000-0000-00000000d003', $q$select id from public.profiles where status = 'rejected'$q$);
select rls_test.probe_rows('profiles: ordinary member M3, all rows', '00000000-0000-0000-0000-00000000d003', 'select id from public.profiles');
select rls_test.probe_rows('profiles: invitee M1, rejected rows', '00000000-0000-0000-0000-00000000d001', $q$select id from public.profiles where status = 'rejected'$q$);
select rls_test.probe_rows('profiles: cell leader CL1, rejected rows', '00000000-0000-0000-0000-00000000f001', $q$select id from public.profiles where status = 'rejected'$q$);
select rls_test.probe_rows('profiles: rejected MR, own row only', '00000000-0000-0000-0000-00000000d005', 'select id from public.profiles');
select rls_test.probe_rows('profiles: administrator AD, rejected rows', '00000000-0000-0000-0000-00000000a001', $q$select id from public.profiles where status = 'rejected'$q$);
select rls_test.probe_rows('profiles: coordinator CO, rejected rows', '00000000-0000-0000-0000-00000000c001', $q$select id from public.profiles where status = 'rejected'$q$);
select rls_test.probe_rows('member_directory: ordinary member M3, rejected rows', '00000000-0000-0000-0000-00000000d003', $q$select * from public.member_directory where status = 'rejected'$q$);
select rls_test.probe_rows('member_directory: cell leader CL1, rejected rows', '00000000-0000-0000-0000-00000000f001', $q$select * from public.member_directory where status = 'rejected'$q$);
select rls_test.probe_rows('member_directory: administrator AD, rejected rows', '00000000-0000-0000-0000-00000000a001', $q$select * from public.member_directory where status = 'rejected'$q$);
select rls_test.probe_rows('user_profiles: cell leader CL1, rejected rows', '00000000-0000-0000-0000-00000000f001', $q$select user_id from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d005'$q$);
select rls_test.probe_rows('user_profiles: coordinator CO, rejected MR row', '00000000-0000-0000-0000-00000000c001', $q$select user_id from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d005'$q$);
select rls_test.probe_rows('memberships: cell leader CL1, rejected MR row', '00000000-0000-0000-0000-00000000f001', $q$select id from public.memberships where person_id = '00000000-0000-0000-0000-00000000d005'$q$);
select rls_test.probe_rows('memberships: coordinator CO, rejected MR row', '00000000-0000-0000-0000-00000000c001', $q$select id from public.memberships where person_id = '00000000-0000-0000-0000-00000000d005'$q$);
\echo -- owner: does a rejected MR membership/profile row exist for the probes?
select 'owner check MR: ' || p.status || ' cell=' || coalesce(p.cell_id::text,'null') from public.profiles p where p.id = '00000000-0000-0000-0000-00000000d005';
