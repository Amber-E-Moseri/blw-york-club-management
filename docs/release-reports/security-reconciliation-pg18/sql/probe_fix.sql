create or replace function rls_test.probe_list(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $f$
declare s text; begin
  perform rls_test.as_user(p_user);
  execute 'select coalesce(string_agg(q::text, '', '' order by q::text), ''<none>'') from (' || p_sql || ') q' into s;
  perform rls_test.as_owner();
  raise notice 'LIST | % | %', p_name, s;
exception when others then
  perform rls_test.as_owner();
  raise notice 'LIST | % | SQLSTATE=% | %', p_name, sqlstate, left(sqlerrm, 120);
end $f$;
create or replace function rls_test.probe_anon(p_name text, p_sql text) returns void language plpgsql as $f$
declare n bigint; begin
  execute 'reset role'; execute 'set local role anon';
  execute 'select count(*) from (' || p_sql || ') q' into n;
  execute 'reset role';
  raise notice 'PROBE | % | SQLSTATE=OK | rows=%', p_name, n;
exception when others then
  execute 'reset role';
  raise notice 'PROBE | % | SQLSTATE=% | %', p_name, sqlstate, left(sqlerrm, 120);
end $f$;
