\echo ===== 1b. ANON ROLE =====
select rls_test.probe_anon('audience_specs: anon role', 'select id from public.audience_specs');
select rls_test.probe_anon('audience_snapshots: anon role', 'select profile_id from public.audience_snapshots');
\echo ===== 2. A1 =====
select rls_test.probe_list('A1: C1 profiles visible to CL1 (excluding self)', '00000000-0000-0000-0000-00000000f001', 'select p.id, p.status from public.profiles p where p.cell_id = ''c1000000-0000-0000-0000-000000000001'' and p.id <> ''00000000-0000-0000-0000-00000000f001''');
select rls_test.probe_list('A1: C1 profiles that exist (owner view, excluding CL1)', null, 'select p.id, p.status from public.profiles p where p.cell_id = ''c1000000-0000-0000-0000-000000000001'' and p.id <> ''00000000-0000-0000-0000-00000000f001''');
\echo ===== 4. PENDING BSC ASSIGNMENT (MP = d004 pending, cell C1) =====
\echo -- initial state
select rls_test.probe_list('MP initial: status/bsc/cell', null, 'select p.status || ''|bsc='' || coalesce(p.bsc_id::text,''null'') || ''|cell='' || coalesce(p.cell_id::text,''null'') from public.profiles p where p.id = ''00000000-0000-0000-0000-00000000d004''');
\echo -- a. ordinary member and cell leader assignment RPC
savepoint s1; select rls_test.probe_write('a1 M3 (ordinary member) assign_member_to_bsc(MP,B1)', '00000000-0000-0000-0000-00000000d003', $q$select public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d004','b1000000-0000-0000-0000-0000000000b1')$q$, 'profiles', '00000000-0000-0000-0000-00000000d004'); rollback to savepoint s1;
savepoint s2; select rls_test.probe_write('a2 CL1 (cell leader) assign_member_to_bsc(MP,B1)', '00000000-0000-0000-0000-00000000f001', $q$select public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d004','b1000000-0000-0000-0000-0000000000b1')$q$, 'profiles', '00000000-0000-0000-0000-00000000d004'); rollback to savepoint s2;
\echo -- b. direct database writes
savepoint s3; select rls_test.probe_write('b1 M3 direct UPDATE bsc_id of MP', '00000000-0000-0000-0000-00000000d003', $q$update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000d004'$q$, 'profiles', '00000000-0000-0000-0000-00000000d004'); rollback to savepoint s3;
savepoint s4; select rls_test.probe_write('b2 CL1 direct UPDATE bsc_id of MP', '00000000-0000-0000-0000-00000000f001', $q$update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000d004'$q$, 'profiles', '00000000-0000-0000-0000-00000000d004'); rollback to savepoint s4;
savepoint s5; select rls_test.probe_write('b3 CO (coordinator) direct UPDATE bsc_id of MP', '00000000-0000-0000-0000-00000000c001', $q$update public.profiles set bsc_id = 'b1000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000d004'$q$, 'profiles', '00000000-0000-0000-0000-00000000d004'); rollback to savepoint s5;
savepoint s6; select rls_test.probe_write('b4 CO assign_member_to_bsc(MP,B1) (authorised staff RPC)', '00000000-0000-0000-0000-00000000c001', $q$select public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d004','b1000000-0000-0000-0000-0000000000b1')$q$, 'profiles', '00000000-0000-0000-0000-00000000d004'); rollback to savepoint s6;
\echo -- c. existing assignment, then status transition to pending
savepoint s7;
select rls_test.probe_write('c1 CO assign active M1 (d001) to B1', '00000000-0000-0000-0000-00000000c001', $q$select public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d001','b1000000-0000-0000-0000-0000000000b1')$q$, 'profiles', '00000000-0000-0000-0000-00000000d001');
select rls_test.probe_list('c1 state after assignment: M1', null, 'select p.status || ''|bsc='' || coalesce(p.bsc_id::text,''null'') from public.profiles p where p.id = ''00000000-0000-0000-0000-00000000d001''');
select rls_test.probe_write('c2 CL1 sets M1 status to pending', '00000000-0000-0000-0000-00000000f001', $q$update public.profiles set status = 'pending' where id = '00000000-0000-0000-0000-00000000d001'$q$, 'profiles', '00000000-0000-0000-0000-00000000d001');
select rls_test.probe_write('c3 CO sets M1 status to pending (authorised staff workflow)', '00000000-0000-0000-0000-00000000c001', $q$update public.profiles set status = 'pending' where id = '00000000-0000-0000-0000-00000000d001'$q$, 'profiles', '00000000-0000-0000-0000-00000000d001');
select rls_test.probe_list('c4 state after pending transition: M1 profile', null, 'select p.status || ''|bsc=''  || coalesce(p.bsc_id::text,''null'') || ''|cell=''  || coalesce(p.cell_id::text,''null'') from public.profiles p where p.id = ''00000000-0000-0000-0000-00000000d001''');
select rls_test.probe_list('c5 BSC B1 leader and roster after transition', null, 'select b.leader_id || ''|''  || coalesce(b.name,''?'') from public.bscs b where b.id = ''b1000000-0000-0000-0000-0000000000b1''');
rollback to savepoint s7;
