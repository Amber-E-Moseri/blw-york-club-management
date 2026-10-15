-- schema_fingerprint.sql
-- READ-ONLY. One SELECT that returns ONE deterministic JSON document describing the security-relevant shape of the
-- database: tables (columns, nullability, defaults, constraints, indexes, policies, triggers, privileges), views,
-- functions (security mode, search_path, EXECUTE grants), default privileges, Storage buckets and policies, extensions
-- and extra schemas. It returns no row data, no emails, no IDs and no secrets.
--
-- Used three ways:
--   1. replay certification: two independent fresh replays must produce byte-identical output;
--   2. contract check:       check_schema_contract.mjs asserts named invariants on this document;
--   3. production parity:    run it in the Supabase SQL Editor of a new project and compare with
--                            schema_fingerprint.golden.json (a read-only operation).
with
t as (
  select c.oid, c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls, pg_get_userbyid(c.relowner) as owner
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
),
roles as (select unnest(array['anon', 'authenticated', 'service_role']) as r),
privs as (select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p),
tbl as (
  select t.relname,
    jsonb_build_object(
      'owner', t.owner,
      'rls', t.rls,
      'force_rls', t.force_rls,
      'columns', coalesce((select jsonb_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || case when a.attnotnull then 'NOT NULL' else 'null' end
                                   || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') order by a.attname)
                  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped), '[]'::jsonb),
      'constraints', coalesce((select jsonb_agg(conname || ' ' || pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid = t.oid), '[]'::jsonb),
      'indexes', coalesce((select jsonb_agg(indexname || ' ' || indexdef order by indexname) from pg_indexes where schemaname = 'public' and tablename = t.relname), '[]'::jsonb),
      'policies', coalesce((select jsonb_agg(policyname || ' | ' || cmd || ' | ' || roles::text || ' | using=' || coalesce(qual, '') || ' | check=' || coalesce(with_check, '') order by policyname)
                   from pg_policies where schemaname = 'public' and tablename = t.relname), '[]'::jsonb),
      'triggers', coalesce((select jsonb_agg(pg_get_triggerdef(tg.oid) order by tg.tgname) from pg_trigger tg where tg.tgrelid = t.oid and not tg.tgisinternal), '[]'::jsonb),
      'privileges', (
        select jsonb_object_agg(r.r, coalesce((
          select string_agg(p.p, ',' order by p.p) from privs p where has_table_privilege(r.r, t.oid, p.p)), ''))
        from roles r),
      'maintain_acl', (select count(*) from aclexplode(coalesce((select relacl from pg_class where oid = t.oid), '{}')) a
                       where a.privilege_type = 'MAINTAIN' and a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')))
    ) as doc
  from t
),
vw as (
  select c.relname,
    jsonb_build_object(
      'definition_md5', md5(pg_get_viewdef(c.oid)),
      'options', coalesce(array_to_string(c.reloptions, ','), ''),
      'privileges', (select jsonb_object_agg(r.r, coalesce((select string_agg(p.p, ',' order by p.p) from privs p where has_table_privilege(r.r, c.oid, p.p)), '')) from roles r)) as doc
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
),
fn as (
  select p.oid::regprocedure::text as sig,
    jsonb_build_object(
      'security', case when p.prosecdef then 'definer' else 'invoker' end,
      'config', coalesce(array_to_string(p.proconfig, ';'), ''),
      'volatility', p.provolatile::text,
      'owner', pg_get_userbyid(p.proowner),
      'execute', jsonb_build_object(
        'public', (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')),
        'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')),
      'definition_md5', md5(pg_get_functiondef(p.oid))) as doc
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
)
select jsonb_pretty(jsonb_build_object(
  'tables', (select jsonb_object_agg(relname, doc) from tbl),
  'views', coalesce((select jsonb_object_agg(relname, doc) from vw), '{}'::jsonb),
  'functions', (select jsonb_object_agg(sig, doc) from fn),
  'default_privileges', (
    select jsonb_agg(d.defaclrole::regrole::text || ' | ' || case when d.defaclnamespace = 0 then '(all)' else d.defaclnamespace::regnamespace::text end
                     || ' | ' || d.defaclobjtype::text || ' | ' || coalesce((
                       select string_agg(case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type, ',' order by a.grantee, a.privilege_type)
                       from aclexplode(d.defaclacl) a), '')
                     order by d.defaclrole::regrole::text, d.defaclnamespace, d.defaclobjtype)
    from pg_default_acl d
    where d.defaclrole::regrole::text in ('postgres', 'supabase_admin') and d.defaclnamespace in (0, 'public'::regnamespace)),
  'storage_buckets', (select jsonb_agg(id || ' | public=' || public::text || ' | max=' || coalesce(file_size_limit::text, '-') || ' | mime=' || coalesce(array_to_string(allowed_mime_types, ','), '-') order by id) from storage.buckets),
  'storage_policies', (select jsonb_agg(policyname || ' | ' || cmd || ' | ' || roles::text || ' | using=' || coalesce(qual, '') || ' | check=' || coalesce(with_check, '') order by policyname)
                       from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  'auth_user_triggers', (select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal),
  'extensions', (select jsonb_agg(extname order by extname) from pg_extension),
  'extra_schemas', coalesce((select jsonb_agg(nspname order by nspname) from pg_namespace
                    where nspname not in ('public', 'information_schema', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'realtime',
                                          'supabase_functions', 'supabase_migrations', 'vault', 'net', 'cron', 'pgbouncer', 'pgsodium',
                                          'pgsodium_masks', '_realtime', '_analytics', 'supabase_vector')
                      and nspname not like 'pg\_%'), '[]'::jsonb)
)) as schema_fingerprint;
