-- 029_secure_email_open_tracking.sql
--
-- Prevent public/open-tracking callers from altering arbitrary email_log rows by
-- requiring an unguessable tracking token in addition to the message id.

alter table public.email_log
  add column if not exists tracking_token uuid not null default gen_random_uuid();

create unique index if not exists email_log_tracking_token_unique
  on public.email_log (tracking_token);

create or replace function public.track_email_open(message_id uuid, token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched integer;
begin
  update public.email_log
     set opened_at = coalesce(opened_at, now())
   where id = message_id
     and tracking_token = token;

  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

revoke all on function public.track_email_open(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.track_email_open(uuid, uuid) to service_role;
