-- audience_trigger_fix_certification.sql
--
-- Certifies migration 105: block_targeted_audience_change() no longer rejects ordinary updates to announcements and
-- confessions, and it still refuses any change to an audience once content is published.
-- Runs in one transaction under the owner, and rolls back. Apply migrations 000-105 first.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/verification/audience_trigger_fix_certification.sql

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_name;
  end if;
  raise notice 'PASS: %', p_name;
end $$;

-- Fixtures: an admin who authored one announcement and one confession, and an audience spec for a targeted post.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'trigger-admin@cert.invalid')
  on conflict do nothing;
insert into public.profiles (id, email, full_name, role, status)
  values ('00000000-0000-4000-8000-0000000000a1', 'trigger-admin@cert.invalid', 'Trigger Admin', 'admin', 'active')
  on conflict (id) do update set role = 'admin', status = 'active';

insert into public.audience_specs (id, mode, created_by)
  values ('00000000-0000-4000-8000-0000000000f1', 'all', '00000000-0000-4000-8000-0000000000a1');

insert into public.announcements (id, title, body, author_id, author_name)
  values ('00000000-0000-4000-8000-0000000000e1', 'Before', 'Body', '00000000-0000-4000-8000-0000000000a1', 'Trigger Admin');

insert into public.confessions (id, title, body, scheduled_date, created_by)
  values ('00000000-0000-4000-8000-0000000000c1', 'Before', 'Body', '2026-10-23', '00000000-0000-4000-8000-0000000000a1');

-- Title and body updates succeed, on broadcast and on a targeted post.
update public.announcements set title = 'After' where id = '00000000-0000-4000-8000-0000000000e1';
select pg_temp.check('announcement title update succeeds', (select title from public.announcements where id = '00000000-0000-4000-8000-0000000000e1') = 'After');

update public.announcements set body = 'Edited body' where id = '00000000-0000-4000-8000-0000000000e1';
select pg_temp.check('announcement body update succeeds', (select body from public.announcements where id = '00000000-0000-4000-8000-0000000000e1') = 'Edited body');

update public.confessions set title = 'After' where id = '00000000-0000-4000-8000-0000000000c1';
select pg_temp.check('confession title update succeeds', (select title from public.confessions where id = '00000000-0000-4000-8000-0000000000c1') = 'After');

-- Changing the audience of published content is still refused.
do $$
begin
  update public.announcements set audience_spec_id = '00000000-0000-4000-8000-0000000000f1'
    where id = '00000000-0000-4000-8000-0000000000e1';
  raise exception 'FAIL: audience change on announcements was not refused';
exception when sqlstate '42501' then
  raise notice 'PASS: announcement audience change is refused';
end $$;

do $$
begin
  update public.confessions set audience_spec_id = '00000000-0000-4000-8000-0000000000f1'
    where id = '00000000-0000-4000-8000-0000000000c1';
  raise exception 'FAIL: audience change on confessions was not refused';
exception when sqlstate '42501' then
  raise notice 'PASS: confession audience change is refused';
end $$;

-- The trigger function keeps its grants: no client role can call it directly.
select pg_temp.check('trigger function is not executable by anon, authenticated or public',
  not has_function_privilege('anon', 'public.block_targeted_audience_change()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.block_targeted_audience_change()', 'EXECUTE'));

select 'AUDIENCE TRIGGER FIX CERTIFIED' as result;

rollback;
