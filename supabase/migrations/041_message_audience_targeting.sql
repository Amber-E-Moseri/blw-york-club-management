-- 041: Add audience targeting columns to weekly_messages
-- Allows messages to be targeted at org-wide, a specific cell, BSC, or member.

ALTER TABLE weekly_messages
  ADD COLUMN IF NOT EXISTS audience_type text NOT NULL DEFAULT 'org'
    CHECK (audience_type IN ('org', 'cell', 'bsc', 'member')),
  ADD COLUMN IF NOT EXISTS audience_id uuid;

-- Index for fast audience lookups when a viewer's profile is checked.
CREATE INDEX IF NOT EXISTS idx_weekly_messages_audience
  ON weekly_messages (audience_type, audience_id);

COMMENT ON COLUMN weekly_messages.audience_type IS
  'Targeting scope: org (everyone), cell, bsc, or member';
COMMENT ON COLUMN weekly_messages.audience_id IS
  'FK to the specific cell/BSC/member when audience_type is not org';
