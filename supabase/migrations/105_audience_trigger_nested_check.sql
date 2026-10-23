-- 105_audience_trigger_nested_check.sql
--
-- Forward fix to migration 075. Historical migrations are not edited.
--
-- Defect. block_targeted_audience_change() (075) checked the events audience inside one boolean expression:
--   if tg_table_name = 'events' and new.audience is distinct from old.audience then ...
-- PostgreSQL evaluates both operands, so for announcements and confessions the trigger referenced new.audience,
-- which those tables do not have. Every UPDATE on announcements and confessions failed for every role, including
-- admins and coordinators, with: record "new" has no field "audience". Editing or deactivating a post was impossible.
--
-- Fix. The events-only comparison is nested in its own IF, so it is evaluated only for events. The behaviour is
-- otherwise unchanged: changing audience_spec_id is refused on every table, and changing events.audience is refused
-- for events. The error text and SQLSTATE are the same as before.

create or replace function public.block_targeted_audience_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.audience_spec_id is distinct from old.audience_spec_id then
    raise exception 'audience of published content cannot be changed; create new content instead' using errcode = '42501';
  end if;
  if tg_table_name = 'events' then
    if new.audience is distinct from old.audience then
      raise exception 'audience of published content cannot be changed; create new content instead' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;
