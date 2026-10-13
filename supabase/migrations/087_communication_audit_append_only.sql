-- 087_communication_audit_append_only.sql
--
-- Forward-only. Closes a gap found after 086: communication_audit still gave service_role UPDATE, DELETE and SELECT,
-- so any API key that holds service_role could rewrite or delete the record of a send or a dispatch.
--
-- Legitimate writers (inventory):
--   1. send_message (069, SECURITY DEFINER, owner) inserts action = 'send'. It runs as the owner and needs no grant.
--   2. dispatch-message (Edge Function, service_role client) inserts action = 'dispatch' before any provider is called.
--      This is the only direct use of the table, and it needs INSERT only: it never reads or changes the audit.
-- No writer updates or deletes an audit row, and no service_role path reads the table.
--
-- Changes:
--   a. service_role keeps INSERT and loses UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and SELECT.
--   b. An append-only guard refuses UPDATE and DELETE on every row, and TRUNCATE on the table, for every role including
--      the owner. Owner-run definer code still inserts normally.
--
-- Effect on deletion: communication_audit.message_id references communication_messages with ON DELETE CASCADE (069).
-- Deleting a message that has audit rows is now refused with 42501, because the cascade would remove audit rows. No
-- product path deletes messages (certification tests record this).
--
-- Not changed here: communication_messages, communication_recipients and communication_deliveries keep service_role DML
-- because the Edge workers update delivery status.
--
-- Dependencies: 069 (communication_audit, send_message, dispatch-message contract).

revoke update, delete, truncate, references, trigger, select on table public.communication_audit from service_role;

create or replace function public.communication_audit_block_change()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  raise exception 'communication audit rows are append-only' using errcode = '42501';
end;
$function$;

revoke all on function public.communication_audit_block_change() from public, anon, authenticated, service_role;

drop trigger if exists communication_audit_append_only on public.communication_audit;
create trigger communication_audit_append_only
  before update or delete on public.communication_audit
  for each row execute function public.communication_audit_block_change();

drop trigger if exists communication_audit_no_truncate on public.communication_audit;
create trigger communication_audit_no_truncate
  before truncate on public.communication_audit
  for each statement execute function public.communication_audit_block_change();
