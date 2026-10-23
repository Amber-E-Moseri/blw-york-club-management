-- 105_block_targeted_audience_change_fix.sql
--
-- Forward-only fix to block_targeted_audience_change() (created in 075). Historical migrations are not edited.
--
-- Defect: the events-only branch reads new.audience and old.audience directly. PL/pgSQL does not evaluate the
-- tg_table_name test first in a way that protects the field reference, so the record field is resolved for every
-- table. announcements and confessions have no audience column, so every UPDATE on them fails with:
--     record "new" has no field "audience"
-- That blocks editing and deleting announcements, and it blocks any update to confessions.
--
-- Fix: read the audience key through to_jsonb(), which returns NULL for a missing key instead of raising. The
-- events check keeps its meaning. The audience_spec_id check, which applies to all three tables, is unchanged.
--
-- create or replace keeps the function's owner, its set search_path, and the EXECUTE revocations made in 082.

create or replace function public.block_targeted_audience_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.audience_spec_id is distinct from old.audience_spec_id then
    raise exception 'audience of published content cannot be changed; create new content instead' using errcode = '42501';
  end if;
  if tg_table_name = 'events'
     and (to_jsonb(new) -> 'audience') is distinct from (to_jsonb(old) -> 'audience') then
    raise exception 'audience of published content cannot be changed; create new content instead' using errcode = '42501';
  end if;
  return new;
end;
$$;
