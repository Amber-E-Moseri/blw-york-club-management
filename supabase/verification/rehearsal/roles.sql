-- Local rehearsal only: Supabase platform roles that migrations reference. Creates nothing hosted and holds no secrets.
do $$ declare r text; begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  foreach r in array array['supabase_admin','supabase_auth_admin','supabase_storage_admin','authenticator','dashboard_user'] loop
    if not exists (select 1 from pg_roles where rolname=r) then execute format('create role %I nologin', r); end if;
  end loop;
end $$;
