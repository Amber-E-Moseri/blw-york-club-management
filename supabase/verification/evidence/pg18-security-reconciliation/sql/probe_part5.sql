\echo ===== 7. A1 DISCREPANCY =====
select 'OWNER C1 others: ' || p.id || ' ' || p.status || ' ' || p.full_name from public.profiles p where p.cell_id = 'c1000000-0000-0000-0000-000000000001' and p.id <> '00000000-0000-0000-0000-00000000f001' order by p.full_name;
begin; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000f001',true); set local role authenticated;
select 'CL1 VISIBLE: ' || p.id || ' ' || p.status || ' ' || p.full_name from public.profiles p where p.cell_id = 'c1000000-0000-0000-0000-000000000001' and p.id <> '00000000-0000-0000-0000-00000000f001' order by p.full_name;
select 'CL1 visible count: ' || count(*) from public.profiles p where p.cell_id = 'c1000000-0000-0000-0000-000000000001' and p.id <> '00000000-0000-0000-0000-00000000f001';
rollback;
