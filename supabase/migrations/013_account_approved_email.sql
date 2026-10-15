-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Add account_approved email template type
-- Purpose: Enable sending account approval notifications when coordinators approve
--          pending member accounts
-- ═══════════════════════════════════════════════════════════════════════════════

-- Update email_log CHECK constraint to include 'account_approved'
ALTER TABLE public.email_log
DROP CONSTRAINT IF EXISTS email_log_template_type_check;

ALTER TABLE public.email_log
ADD CONSTRAINT email_log_template_type_check CHECK (template_type IN (
  'meeting_reminder_8am',
  'meeting_reminder_1hr',
  'message_notification',
  'habit_milestone',
  'devotional_reminder',
  'testimony_approved',
  'weekly_digest',
  'account_approved',
  'generic'
));
