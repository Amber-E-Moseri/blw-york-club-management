-- 037_find_person_by_email.sql
--
-- Exact, case-insensitive email lookup using the same identity rule as the unique index
-- people_email_normalized_unique: normalize_identity_email(email) = lower(trim(email)).
-- Replaces client-side .ilike() matching, which treated '_', '%' (and PostgREST '*') as wildcards.
-- SECURITY INVOKER: row-level security on public.people still decides what the caller can see.

create or replace function public.find_person_by_email(p_email text)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id
  from public.people p
  where public.normalize_identity_email(p_email) is not null
    and public.normalize_identity_email(p.email) = public.normalize_identity_email(p_email)
  limit 1
$$;

revoke all on function public.find_person_by_email(text) from public, anon;
grant execute on function public.find_person_by_email(text) to authenticated, service_role;
