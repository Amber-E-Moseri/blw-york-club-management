-- ═══════════════════════════════════════════════════════════════
-- Phase 6 Schema: Email + Push Notifications + Zoom Integration
-- Fully idempotent — safe to re-run
-- ═══════════════════════════════════════════════════════════════

-- Phase-6 tables are reconciled additively. Do not drop existing notification
-- tables: earlier phase-2 migrations may already contain user preferences or
-- push endpoints that must survive replay against a non-empty local database.

-- ═══════════════════════════════════════════════════════════════
-- Email Notifications
-- ═══════════════════════════════════════════════════════════════

-- ─── Email Preferences ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_preferences (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id             UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meeting_reminders_8am BOOLEAN     NOT NULL DEFAULT true,
  meeting_reminders_1hr BOOLEAN     NOT NULL DEFAULT true,
  message_notifications BOOLEAN     NOT NULL DEFAULT true,
  habit_milestones      BOOLEAN     NOT NULL DEFAULT true,
  devotional_reminders  BOOLEAN     NOT NULL DEFAULT true,
  testimony_approved    BOOLEAN     NOT NULL DEFAULT true,
  weekly_digest         BOOLEAN     NOT NULL DEFAULT false,
  admin_announcements   BOOLEAN     NOT NULL DEFAULT true,
  opt_out_all           BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id)
);

ALTER TABLE public.email_preferences
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS meeting_reminders_8am boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS meeting_reminders_1hr boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS message_notifications boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS habit_milestones boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS devotional_reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS testimony_approved boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weekly_digest boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_announcements boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS opt_out_all boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_preferences'
      AND column_name = 'user_id'
  ) THEN
    UPDATE public.email_preferences
    SET member_id = user_id
    WHERE member_id IS NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS email_preferences_member_id_unique
  ON public.email_preferences (member_id)
  WHERE member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_prefs_member ON public.email_preferences (member_id);

ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_prefs_own_read" ON public.email_preferences;
CREATE POLICY "email_prefs_own_read"
  ON public.email_preferences FOR SELECT
  USING (auth.uid() = member_id);

DROP POLICY IF EXISTS "email_prefs_own_write" ON public.email_preferences;
CREATE POLICY "email_prefs_own_write"
  ON public.email_preferences FOR ALL
  USING (auth.uid() = member_id)
  WITH CHECK (auth.uid() = member_id);

DROP POLICY IF EXISTS "email_prefs_admin_read" ON public.email_preferences;
CREATE POLICY "email_prefs_admin_read"
  ON public.email_preferences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

DROP TRIGGER IF EXISTS set_email_prefs_updated_at ON public.email_preferences;
CREATE TRIGGER set_email_prefs_updated_at
  BEFORE UPDATE ON public.email_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Email Log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_log (
  id             UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id      UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email VARCHAR(320) NOT NULL,
  subject        VARCHAR(998) NOT NULL,
  template_type  VARCHAR(50)  NOT NULL
                 CHECK (template_type IN (
                   'meeting_reminder_8am','meeting_reminder_1hr',
                   'message_notification','habit_milestone',
                   'devotional_reminder','testimony_approved',
                   'weekly_digest','generic'
                 )),
  status         VARCHAR(20)  NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','failed','bounced')),
  sent_at        TIMESTAMPTZ,
  failed_reason  VARCHAR(500),
  opened_at      TIMESTAMPTZ,
  clicked_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_member   ON public.email_log (member_id);
CREATE INDEX IF NOT EXISTS idx_email_log_status   ON public.email_log (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_template ON public.email_log (template_type, created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_log_own_read" ON public.email_log;
CREATE POLICY "email_log_own_read"
  ON public.email_log FOR SELECT
  USING (auth.uid() = member_id);

DROP POLICY IF EXISTS "email_log_admin_read" ON public.email_log;
CREATE POLICY "email_log_admin_read"
  ON public.email_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

-- Insert restricted to service role (edge functions use service key)

-- ─── Scheduled Emails ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scheduled_emails (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_email VARCHAR(320) NOT NULL,
  subject         VARCHAR(998) NOT NULL,
  html_content    TEXT         NOT NULL,
  scheduled_for   TIMESTAMPTZ  NOT NULL,
  sent            BOOLEAN      NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_pending
  ON public.scheduled_emails (scheduled_for)
  WHERE sent = false;

ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;
-- Only service role may access scheduled_emails

-- ═══════════════════════════════════════════════════════════════
-- Web Push Notifications
-- ═══════════════════════════════════════════════════════════════

-- ─── Push Subscriptions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id     UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint      TEXT         NOT NULL,
  auth          VARCHAR(512) NOT NULL,
  p256dh        VARCHAR(512) NOT NULL,
  user_agent    VARCHAR(500),
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  subscribed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_used     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS endpoint text,
  ADD COLUMN IF NOT EXISTS auth varchar(512),
  ADD COLUMN IF NOT EXISTS p256dh varchar(512),
  ADD COLUMN IF NOT EXISTS user_agent varchar(500),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS subscribed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_used timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'push_subscriptions'
      AND column_name = 'user_id'
  ) THEN
    UPDATE public.push_subscriptions
    SET member_id = user_id
    WHERE member_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_push_subs_member ON public.push_subscriptions (member_id, is_active);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subs_own_read" ON public.push_subscriptions;
CREATE POLICY "push_subs_own_read"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = member_id);

DROP POLICY IF EXISTS "push_subs_own_delete" ON public.push_subscriptions;
CREATE POLICY "push_subs_own_delete"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = member_id);

DROP POLICY IF EXISTS "push_subs_admin_read" ON public.push_subscriptions;
CREATE POLICY "push_subs_admin_read"
  ON public.push_subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

-- Insert/update restricted to service role

-- ─── Push Notification Log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_notification_log (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type VARCHAR(30) NOT NULL
                    CHECK (notification_type IN ('meeting','message','prophecy','habit','devotional')),
  title             VARCHAR(200) NOT NULL,
  body              VARCHAR(500) NOT NULL,
  status            VARCHAR(20)  NOT NULL
                    CHECK (status IN ('sent','failed','clicked','dismissed')),
  sent_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  clicked_at        TIMESTAMPTZ,
  response_data     JSONB,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.push_notification_log
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_data jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'push_notification_log'
      AND column_name = 'user_id'
  ) THEN
    UPDATE public.push_notification_log
    SET member_id = user_id
    WHERE member_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_push_log_member ON public.push_notification_log (member_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_log_type   ON public.push_notification_log (notification_type, sent_at DESC);

ALTER TABLE public.push_notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_log_own_read" ON public.push_notification_log;
CREATE POLICY "push_log_own_read"
  ON public.push_notification_log FOR SELECT
  USING (auth.uid() = member_id);

DROP POLICY IF EXISTS "push_log_admin_read" ON public.push_notification_log;
CREATE POLICY "push_log_admin_read"
  ON public.push_notification_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

-- Writes restricted to service role

-- ═══════════════════════════════════════════════════════════════
-- Zoom Integration
-- ═══════════════════════════════════════════════════════════════

-- ─── Ensure meetings table exists (may have been created manually) ────────────

CREATE TABLE IF NOT EXISTS public.meetings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT        NOT NULL,
  description    TEXT,
  date           DATE        NOT NULL,
  time           TIME        NOT NULL,
  end_time       TIME,
  location       TEXT,
  zoom_link      TEXT,
  visibility     TEXT        NOT NULL DEFAULT 'public'
                 CHECK (visibility IN ('public','leaders','cell','explicit')),
  cell_id        UUID        REFERENCES public.cells(id),
  created_by     UUID        NOT NULL REFERENCES public.profiles(id),
  reminder_sent  BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS meetings_updated_at ON public.meetings;
CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "meetings_public_read" ON public.meetings;
CREATE POLICY "meetings_public_read" ON public.meetings FOR SELECT
  USING (auth.role() = 'authenticated' AND visibility = 'public');

DROP POLICY IF EXISTS "meetings_leaders_read" ON public.meetings;
CREATE POLICY "meetings_leaders_read" ON public.meetings FOR SELECT
  USING (
    visibility = 'leaders' AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('cell_leader','admin','coordinator')
    )
  );

DROP POLICY IF EXISTS "meetings_cell_read" ON public.meetings;
CREATE POLICY "meetings_cell_read" ON public.meetings FOR SELECT
  USING (
    visibility = 'cell' AND EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND cell_id = meetings.cell_id
    )
  );

DROP POLICY IF EXISTS "meetings_manage" ON public.meetings;
CREATE POLICY "meetings_manage" ON public.meetings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin','coordinator','cell_leader')
    )
  );

CREATE TABLE IF NOT EXISTS public.meeting_attendances (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   UUID        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name    TEXT        NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attended     BOOLEAN,
  UNIQUE (meeting_id, user_id)
);

ALTER TABLE public.meeting_attendances ENABLE ROW LEVEL SECURITY;

-- ─── Add Zoom columns to meetings ────────────────────────────────────────────

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS zoom_meeting_id VARCHAR,
  ADD COLUMN IF NOT EXISTS zoom_join_url   VARCHAR,
  ADD COLUMN IF NOT EXISTS zoom_start_url  VARCHAR,
  ADD COLUMN IF NOT EXISTS zoom_password   VARCHAR,
  ADD COLUMN IF NOT EXISTS zoom_created    BOOLEAN NOT NULL DEFAULT false;

-- ─── Zoom Settings ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.zoom_settings (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  zoom_account_id  VARCHAR(100) NOT NULL DEFAULT '',
  zoom_user_id     VARCHAR(100) NOT NULL DEFAULT '',
  is_active        BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.zoom_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zoom_settings_admin" ON public.zoom_settings;
CREATE POLICY "zoom_settings_admin"
  ON public.zoom_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

DROP TRIGGER IF EXISTS set_zoom_settings_updated_at ON public.zoom_settings;
CREATE TRIGGER set_zoom_settings_updated_at
  BEFORE UPDATE ON public.zoom_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Zoom Attendance ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.zoom_attendance (
  id                   UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id           UUID         NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  zoom_participant_id  VARCHAR(100) NOT NULL,
  participant_name     VARCHAR(200) NOT NULL,
  participant_email    VARCHAR(320) NOT NULL DEFAULT '',
  member_id            UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  join_time            TIMESTAMPTZ  NOT NULL,
  leave_time           TIMESTAMPTZ  NOT NULL,
  duration_minutes     INT          NOT NULL DEFAULT 0,
  synced_from_zoom     BOOLEAN      NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoom_attendance_meeting ON public.zoom_attendance (meeting_id);
CREATE INDEX IF NOT EXISTS idx_zoom_attendance_member  ON public.zoom_attendance (member_id);

ALTER TABLE public.zoom_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zoom_attendance_admin_read" ON public.zoom_attendance;
CREATE POLICY "zoom_attendance_admin_read"
  ON public.zoom_attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator', 'cell_leader')
    )
  );

-- Writes restricted to service role (synced via edge function)
