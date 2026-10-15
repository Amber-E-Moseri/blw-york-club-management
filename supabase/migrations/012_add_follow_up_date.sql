-- ─── Migration 012: Add follow_up_date to contacts ───────────────────────────
-- Addresses the FOLLOW-UP SCHEDULING DOMAIN GAP identified in certification §9.
--
-- Currently contacts store only date_contacted + follow_up_status.
-- Dashboard Needs Attention uses date_contacted as a proxy for urgency,
-- which is semantically wrong: a contact made September 5 with a follow-up
-- scheduled September 20 must not appear "10 days overdue" on September 15.
--
-- This additive column enables:
--   - Scheduling a specific follow-up date when setting status to "Will Follow Up"
--   - Correct overdue calculation: follow_up_date < today = overdue
--   - Future due-soon: follow_up_date <= today+2 = due soon
--   - Null = no date scheduled (keep current urgency behavior as fallback)
--
-- APPLY VIA: Supabase Studio → SQL Editor
--   https://supabase.com/dashboard/project/hecropqaidcveeoagsgy/sql/new

alter table public.contacts
  add column if not exists follow_up_date date;

comment on column public.contacts.follow_up_date is
  'Optional scheduled follow-up date. Null = no specific date set. '
  'Used by Dashboard Needs Attention for overdue/due-soon calculations.';

create index if not exists contacts_follow_up_date_idx
  on public.contacts(follow_up_date)
  where follow_up_date is not null and archived = false;
