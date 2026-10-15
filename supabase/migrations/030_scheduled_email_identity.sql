-- 030_scheduled_email_identity.sql
--
-- Add identity columns to scheduled_emails so that preference enforcement can
-- run at delivery time rather than schedule time.
--
-- Without member_id the process-scheduled-emails function has no way to look up
-- the recipient's email_preferences row, causing all scheduled ordinary sends to
-- be fail-closed once preference enforcement is active.  Existing rows are left
-- with member_id = NULL; the delivery function skips them if the relay is not yet
-- configured (no real sends have occurred in production yet).
--
-- template_type lets the delivery path apply the correct preference column gate
-- without guessing from subject text.

alter table public.scheduled_emails
  add column if not exists member_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists template_type text not null default 'generic';

comment on column public.scheduled_emails.member_id is
  'profiles.id of the intended recipient.  Required for preference enforcement at delivery time.';
comment on column public.scheduled_emails.template_type is
  'EmailTemplateType string; drives the preference column gate in the delivery function.';

create index if not exists idx_scheduled_emails_member_id
  on public.scheduled_emails (member_id)
  where member_id is not null;
