-- Canonical app tables previously kept only under src/db/.
-- This migration makes a fresh local Supabase replay sufficient for the
-- currently shipped React application surface.

-- Meetings fields used by MeetingInput and calendar views.
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'bsc', 'cell', 'leadership')),
  ADD COLUMN IF NOT EXISTS allow_join_requests boolean NOT NULL DEFAULT false;

-- Weekly messages.
CREATE TABLE IF NOT EXISTS public.weekly_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name varchar(255) NOT NULL,
  scope varchar(20) NOT NULL DEFAULT 'org'
    CHECK (scope IN ('org', 'personal')),
  title varchar(255) NOT NULL,
  body text NOT NULL,
  drive_link varchar(2048),
  week_start date NOT NULL,
  week_end date NOT NULL,
  is_recurring boolean NOT NULL DEFAULT false,
  recurrence_type varchar(20) NOT NULL DEFAULT 'none'
    CHECK (recurrence_type IN ('none', 'weekly', 'biweekly')),
  recurrence_weeks int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_messages_week ON public.weekly_messages (week_start, week_end);
CREATE INDEX IF NOT EXISTS idx_weekly_messages_scope ON public.weekly_messages (scope);
CREATE INDEX IF NOT EXISTS idx_weekly_messages_creator ON public.weekly_messages (created_by);

ALTER TABLE public.weekly_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_messages_read ON public.weekly_messages;
CREATE POLICY weekly_messages_read ON public.weekly_messages
  FOR SELECT USING (scope = 'org' OR auth.uid() = created_by);

DROP POLICY IF EXISTS weekly_messages_insert ON public.weekly_messages;
CREATE POLICY weekly_messages_insert ON public.weekly_messages
  FOR INSERT WITH CHECK (
    auth.uid() = created_by AND (
      scope = 'personal' OR public.is_admin_or_coordinator()
    )
  );

DROP POLICY IF EXISTS weekly_messages_update ON public.weekly_messages;
CREATE POLICY weekly_messages_update ON public.weekly_messages
  FOR UPDATE USING (auth.uid() = created_by OR public.is_admin_or_coordinator())
  WITH CHECK (auth.uid() = created_by OR public.is_admin_or_coordinator());

DROP POLICY IF EXISTS weekly_messages_delete ON public.weekly_messages;
CREATE POLICY weekly_messages_delete ON public.weekly_messages
  FOR DELETE USING (auth.uid() = created_by OR public.is_admin_or_coordinator());

DROP TRIGGER IF EXISTS weekly_messages_updated_at ON public.weekly_messages;
CREATE TRIGGER weekly_messages_updated_at
  BEFORE UPDATE ON public.weekly_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Habits.
CREATE TABLE IF NOT EXISTS public.habit_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name varchar(100) NOT NULL,
  description text,
  icon varchar(10) NOT NULL DEFAULT '*',
  target_days int[] DEFAULT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  is_active boolean NOT NULL DEFAULT true,
  "order" int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_habit_templates_active ON public.habit_templates (is_active, "order");

ALTER TABLE public.habit_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS habit_templates_read ON public.habit_templates;
CREATE POLICY habit_templates_read ON public.habit_templates
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS habit_templates_manage ON public.habit_templates;
CREATE POLICY habit_templates_manage ON public.habit_templates
  FOR ALL USING (public.is_admin_or_coordinator())
  WITH CHECK (public.is_admin_or_coordinator());

CREATE TABLE IF NOT EXISTS public.habit_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES public.habit_templates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  status varchar(10) NOT NULL CHECK (status IN ('done', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, user_id, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_habit_entries_user_date ON public.habit_entries (user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_habit_entries_template ON public.habit_entries (template_id, entry_date);

ALTER TABLE public.habit_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS habit_entries_own ON public.habit_entries;
CREATE POLICY habit_entries_own ON public.habit_entries
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS habit_entries_admin_read ON public.habit_entries;
CREATE POLICY habit_entries_admin_read ON public.habit_entries
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin_or_coordinator());

-- Events and RSVPs.
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  date date NOT NULL,
  time time,
  location text,
  image_url text,
  category text NOT NULL DEFAULT 'Other'
    CHECK (category IN ('Bible Study', 'Worship', 'Fellowship', 'Outreach', 'Prayer', 'Other')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_read ON public.events;
CREATE POLICY events_read ON public.events
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS events_manage ON public.events;
CREATE POLICY events_manage ON public.events
  FOR ALL USING (public.is_admin_or_coordinator())
  WITH CHECK (public.is_admin_or_coordinator());

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_rsvps_own ON public.event_rsvps;
CREATE POLICY event_rsvps_own ON public.event_rsvps
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Announcements.
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  author_id uuid NOT NULL REFERENCES public.profiles(id),
  author_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcements_read ON public.announcements;
CREATE POLICY announcements_read ON public.announcements
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS announcements_manage ON public.announcements;
CREATE POLICY announcements_manage ON public.announcements
  FOR ALL USING (
    public.is_admin_or_coordinator()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'cell_leader'
    )
  )
  WITH CHECK (
    public.is_admin_or_coordinator()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'cell_leader'
    )
  );

-- Daily confessions.
CREATE TABLE IF NOT EXISTS public.confessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  scheduled_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.confessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS confessions_read ON public.confessions;
CREATE POLICY confessions_read ON public.confessions
  FOR SELECT USING (auth.role() = 'authenticated' AND is_active = true);

DROP POLICY IF EXISTS confessions_manage ON public.confessions;
CREATE POLICY confessions_manage ON public.confessions
  FOR ALL USING (public.is_admin_or_coordinator())
  WITH CHECK (public.is_admin_or_coordinator());

CREATE TABLE IF NOT EXISTS public.confession_declarations (
  confession_id uuid NOT NULL REFERENCES public.confessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (confession_id, user_id)
);

ALTER TABLE public.confession_declarations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS confession_declarations_own ON public.confession_declarations;
CREATE POLICY confession_declarations_own ON public.confession_declarations
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS confession_declarations_read ON public.confession_declarations;
CREATE POLICY confession_declarations_read ON public.confession_declarations
  FOR SELECT USING (auth.role() = 'authenticated');
