\echo ===== 6. STAFF WORKFLOW, CORRECTED =====
savepoint t1;
select rls_test.probe_write('u1 CO assigns M1 to B1 (active)', '00000000-0000-0000-0000-00000000c001', $q$select public.assign_member_to_bsc('00000000-0000-0000-0000-00000000d001','b1000000-0000-0000-0000-0000000000b1')$q$, 'profiles', '00000000-0000-0000-0000-00000000d001');
select rls_test.probe_write('u2 CO set_member_status(M1 active -> inactive)', '00000000-0000-0000-0000-00000000c001', $q$select public.set_member_status('00000000-0000-0000-0000-00000000d001','inactive','probe')$q$, 'profiles', '00000000-0000-0000-0000-00000000d001');
\echo -- owner view after u2
select 'u2 M1: ' || p.status || ' | bsc=' || coalesce(p.bsc_id::text,'null') || ' | cell=' || coalesce(p.cell_id::text,'null') || ' | B1 leader=' || coalesce((select leader_id::text from public.bscs where id = 'b1000000-0000-0000-0000-0000000000b1'),'null') from public.profiles p where p.id = '00000000-0000-0000-0000-00000000d001';
select rls_test.probe_write('u3 CO reject MP (pending -> rejected)', '00000000-0000-0000-0000-00000000c001', $q$select public.reject_pending_member('00000000-0000-0000-0000-00000000d004'::uuid)$q$, 'profiles', '00000000-0000-0000-0000-00000000d004');
select rls_test.probe_write('u4 CO reopen MP (rejected -> pending)', '00000000-0000-0000-0000-00000000c001', $q$select public.set_member_status('00000000-0000-0000-0000-00000000d004','pending','probe')$q$, 'profiles', '00000000-0000-0000-0000-00000000d004');
select 'u4 MP: ' || p.status || ' | bsc=' || coalesce(p.bsc_id::text,'null') || ' | cell=' || coalesce(p.cell_id::text,'null') from public.profiles p where p.id = '00000000-0000-0000-0000-00000000d004';
rollback to savepoint t1;
