-- ═══════════════════════════════════════════════════════════════════════════════
-- Missing Growth & Foundation School Tables
-- Adds devotionals, books, prayer requests, and foundation school persistence
-- Safe to re-run (uses IF NOT EXISTS, DROP POLICY IF EXISTS)
-- ═══════════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. MONTHLY DEVOTIONALS (collection of daily pages)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.monthly_devotionals (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  month          INT         NOT NULL CHECK (month >= 1 AND month <= 12),
  year           INT         NOT NULL,
  title          TEXT        NOT NULL,
  book_title     TEXT        NOT NULL,
  author         TEXT,
  total_days     INT         NOT NULL,
  total_pages    INT         NOT NULL,
  created_by     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month, year)
);

CREATE INDEX IF NOT EXISTS idx_monthly_devotionals_month_year
  ON public.monthly_devotionals (month, year DESC);

ALTER TABLE public.monthly_devotionals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "devotional_read" ON public.monthly_devotionals;
CREATE POLICY "devotional_read" ON public.monthly_devotionals FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "devotional_manage" ON public.monthly_devotionals;
CREATE POLICY "devotional_manage" ON public.monthly_devotionals FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

-- Auto-update updated_at
DROP TRIGGER IF EXISTS monthly_devotionals_updated_at ON public.monthly_devotionals;
CREATE TRIGGER monthly_devotionals_updated_at
  BEFORE UPDATE ON public.monthly_devotionals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DEVOTIONAL DAILY PAGES (individual daily pages within a devotional)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.devotional_daily_pages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  devotional_id  UUID        NOT NULL REFERENCES public.monthly_devotionals(id) ON DELETE CASCADE,
  day_of_month   INT         NOT NULL CHECK (day_of_month >= 1 AND day_of_month <= 31),
  page_range     TEXT        NOT NULL,
  image_url      TEXT        NOT NULL,
  title          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (devotional_id, day_of_month)
);

CREATE INDEX IF NOT EXISTS idx_devotional_daily_pages_devotional_id
  ON public.devotional_daily_pages (devotional_id, day_of_month);

ALTER TABLE public.devotional_daily_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_pages_read" ON public.devotional_daily_pages;
CREATE POLICY "daily_pages_read" ON public.devotional_daily_pages FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "daily_pages_manage" ON public.devotional_daily_pages;
CREATE POLICY "daily_pages_manage" ON public.devotional_daily_pages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DEVOTIONAL VIEWS (user read state / engagement)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.devotional_views (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  devotional_id  UUID        NOT NULL REFERENCES public.monthly_devotionals(id) ON DELETE CASCADE,
  day_of_month   INT         NOT NULL,
  viewed_date    DATE        NOT NULL,
  viewed_at      TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, devotional_id, day_of_month, viewed_date)
);

CREATE INDEX IF NOT EXISTS idx_devotional_views_member_id
  ON public.devotional_views (member_id, viewed_date DESC);
CREATE INDEX IF NOT EXISTS idx_devotional_views_devotional_id
  ON public.devotional_views (devotional_id, day_of_month);

ALTER TABLE public.devotional_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "views_own" ON public.devotional_views;
CREATE POLICY "views_own" ON public.devotional_views FOR ALL
  USING (auth.uid() = member_id);

DROP POLICY IF EXISTS "views_admin_read" ON public.devotional_views;
CREATE POLICY "views_admin_read" ON public.devotional_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BOOKS OF THE MONTH (reading list / book club)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.books_of_month (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL,
  author            TEXT        NOT NULL,
  description       TEXT,
  cover_image_url   TEXT,
  drive_url         TEXT        NOT NULL,
  active_from       DATE        NOT NULL,
  active_until      DATE        NOT NULL,
  created_by        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_books_active_period
  ON public.books_of_month (active_from, active_until);

ALTER TABLE public.books_of_month ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "books_read" ON public.books_of_month;
CREATE POLICY "books_read" ON public.books_of_month FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "books_manage" ON public.books_of_month;
CREATE POLICY "books_manage" ON public.books_of_month FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

DROP TRIGGER IF EXISTS books_of_month_updated_at ON public.books_of_month;
CREATE TRIGGER books_of_month_updated_at
  BEFORE UPDATE ON public.books_of_month
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PRAYER REQUESTS (prayer board / intercession tracking)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.prayer_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content        TEXT        NOT NULL,
  author_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name    TEXT        NOT NULL,
  is_anonymous   BOOLEAN     NOT NULL DEFAULT false,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  visibility     TEXT        NOT NULL DEFAULT 'shared'
                 CHECK (visibility IN ('private', 'leadership', 'shared')),
  answered_at    TIMESTAMPTZ,
  answered_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prayer_requests_active_created
  ON public.prayer_requests (is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prayer_requests_author_id
  ON public.prayer_requests (author_id);

ALTER TABLE public.prayer_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prayers_own" ON public.prayer_requests;
CREATE POLICY "prayers_own" ON public.prayer_requests FOR ALL
  USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "prayers_shared_read" ON public.prayer_requests;
CREATE POLICY "prayers_shared_read" ON public.prayer_requests FOR SELECT
  USING (
    visibility = 'shared' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "prayers_leadership_read" ON public.prayer_requests;
CREATE POLICY "prayers_leadership_read" ON public.prayer_requests FOR SELECT
  USING (
    visibility IN ('leadership', 'shared') AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin', 'cell_leader')
    )
  );

DROP POLICY IF EXISTS "prayers_coordinator_manage" ON public.prayer_requests;
CREATE POLICY "prayers_coordinator_manage" ON public.prayer_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

DROP TRIGGER IF EXISTS prayer_requests_updated_at ON public.prayer_requests;
CREATE TRIGGER prayer_requests_updated_at
  BEFORE UPDATE ON public.prayer_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. FOUNDATION SCHOOL CLASSES (curriculum)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.foundation_school_classes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_number     INT         NOT NULL UNIQUE CHECK (class_number >= 1 AND class_number <= 10),
  title            TEXT        NOT NULL,
  description      TEXT,
  duration_hours   INT,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foundation_classes_number
  ON public.foundation_school_classes (class_number);

ALTER TABLE public.foundation_school_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "classes_read" ON public.foundation_school_classes;
CREATE POLICY "classes_read" ON public.foundation_school_classes FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "classes_manage" ON public.foundation_school_classes;
CREATE POLICY "classes_manage" ON public.foundation_school_classes FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

DROP TRIGGER IF EXISTS foundation_classes_updated_at ON public.foundation_school_classes;
CREATE TRIGGER foundation_classes_updated_at
  BEFORE UPDATE ON public.foundation_school_classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. FOUNDATION SCHOOL ENROLLMENTS (student enrollment records)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.foundation_school_enrollments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  teacher_id       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  enrollment_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  completion_date  DATE,
  is_graduated     BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id)
);

CREATE INDEX IF NOT EXISTS idx_foundation_enrollments_student_id
  ON public.foundation_school_enrollments (student_id);
CREATE INDEX IF NOT EXISTS idx_foundation_enrollments_teacher_id
  ON public.foundation_school_enrollments (teacher_id);

ALTER TABLE public.foundation_school_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enrollments_own" ON public.foundation_school_enrollments;
CREATE POLICY "enrollments_own" ON public.foundation_school_enrollments FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "enrollments_coordinator" ON public.foundation_school_enrollments;
CREATE POLICY "enrollments_coordinator" ON public.foundation_school_enrollments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

DROP POLICY IF EXISTS "enrollments_teacher_read" ON public.foundation_school_enrollments;
CREATE POLICY "enrollments_teacher_read" ON public.foundation_school_enrollments FOR SELECT
  USING (auth.uid() = teacher_id);

DROP TRIGGER IF EXISTS foundation_enrollments_updated_at ON public.foundation_school_enrollments;
CREATE TRIGGER foundation_enrollments_updated_at
  BEFORE UPDATE ON public.foundation_school_enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. FOUNDATION SCHOOL PROGRESS (class completion tracking)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.foundation_school_progress (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id    UUID        NOT NULL REFERENCES public.foundation_school_enrollments(id) ON DELETE CASCADE,
  class_id         UUID        NOT NULL REFERENCES public.foundation_school_classes(id) ON DELETE CASCADE,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_foundation_progress_enrollment
  ON public.foundation_school_progress (enrollment_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_foundation_progress_class
  ON public.foundation_school_progress (class_id);

ALTER TABLE public.foundation_school_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "progress_own" ON public.foundation_school_progress;
CREATE POLICY "progress_own" ON public.foundation_school_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.foundation_school_enrollments
      WHERE foundation_school_enrollments.id = foundation_school_progress.enrollment_id AND student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "progress_coordinator" ON public.foundation_school_progress;
CREATE POLICY "progress_coordinator" ON public.foundation_school_progress FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

DROP POLICY IF EXISTS "progress_teacher_read" ON public.foundation_school_progress;
CREATE POLICY "progress_teacher_read" ON public.foundation_school_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.foundation_school_enrollments
      WHERE foundation_school_enrollments.id = foundation_school_progress.enrollment_id AND teacher_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration complete. All tables use IF NOT EXISTS and RLS is enforced.
-- ═══════════════════════════════════════════════════════════════════════════════
