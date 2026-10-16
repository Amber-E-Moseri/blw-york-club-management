-- Helpers for the gap probes. Each scenario runs inside a savepoint and is rolled back.
create or replace function rls_test.probe_rows(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $f$
declare n bigint; begin
  perform rls_test.as_user(p_user);
  execute 'select count(*) from (' || p_sql || ') q' into n;
  perform rls_test.as_owner();
  raise notice 'PROBE | % | SQLSTATE=OK | rows=%', p_name, n;
exception when others then
  perform rls_test.as_owner();
  raise notice 'PROBE | % | SQLSTATE=% | %', p_name, sqlstate, left(sqlerrm, 120);
end $f$;

create or replace function rls_test.probe_list(p_name text, p_user uuid, p_sql text) returns void language plpgsql as $f$
declare s text; begin
  perform rls_test.as_user(p_user);
  execute 'select coalesce(string_agg(x::text, '', '' order by x::text), ''<none>'') from (' || p_sql || ') q' into s;
  perform rls_test.as_owner();
  raise notice 'LIST | % | %', p_name, s;
exception when others then
  perform rls_test.as_owner();
  raise notice 'LIST | % | SQLSTATE=% | %', p_name, sqlstate, left(sqlerrm, 120);
end $f$;

-- Runs a write as p_user, reports SQLSTATE and rows, and the target row before and after (as owner).
create or replace function rls_test.probe_write(p_name text, p_user uuid, p_sql text, p_table text, p_id uuid) returns void language plpgsql as $f$
declare before_row text; after_row text; n bigint; st text := 'OK'; msg text := '';
begin
  execute format('select to_jsonb(t)::text from public.%I t where id = $1', p_table) into before_row using p_id;
  perform rls_test.as_user(p_user);
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    st := sqlstate; msg := left(sqlerrm, 100); n := -1;
  end;
  perform rls_test.as_owner();
  execute format('select to_jsonb(t)::text from public.%I t where id = $1', p_table) into after_row using p_id;
  raise notice 'WRITE | % | SQLSTATE=% rows=% %| target unchanged=%', p_name, st, n, case when msg <> '' then '| ' || msg || ' ' else '' end, (before_row is not distinct from after_row);
end $f$;
