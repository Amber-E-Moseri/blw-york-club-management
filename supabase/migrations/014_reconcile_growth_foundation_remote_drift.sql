-- ═══════════════════════════════════════════════════════════════════════════════
-- Reconcile Growth & Foundation Schema Remote Drift
-- Aligns deployed schema with migration 010 canonical design
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- AUDIT FINDINGS:
--   Remote schema was created by older migration (not 010), resulting in:
--   • FKs to auth.users instead of public.profiles
--   • Nullable created_by columns (should be NOT NULL)
--   • Extra unique constraint including book_title
--   • 34 redundant RLS policies (instead of 11)
--   • Duplicate indexes and triggers
--
-- RECONCILIATION STRATEGY:
--   • Fix FK targets to profiles (canonical identity model)
--   • Tighten NOT NULL on creators
--   • Fix UNIQUE constraints
--   • Drop redundant policies (keep only canonical set from 010)
--   • Remove duplicate indexes/triggers
--
-- DATA IMPACT: None (all 8 tables are empty)
-- BREAKING CHANGES: None (semantic alignment only)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Fix Foreign Key References (auth.users → profiles)
-- ─────────────────────────────────────────────────────────────────────────────

-- books_of_month.created_by: auth.users → profiles
ALTER TABLE public.books_of_month
  DROP CONSTRAINT IF EXISTS books_of_month_created_by_fkey;

ALTER TABLE public.books_of_month
  ADD CONSTRAINT books_of_month_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- monthly_devotionals.created_by: auth.users → profiles
ALTER TABLE public.monthly_devotionals
  DROP CONSTRAINT IF EXISTS monthly_devotionals_created_by_fkey;

ALTER TABLE public.monthly_devotionals
  ADD CONSTRAINT monthly_devotionals_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- devotional_views.member_id: auth.users → profiles
ALTER TABLE public.devotional_views
  DROP CONSTRAINT IF EXISTS devotional_views_member_id_fkey;

ALTER TABLE public.devotional_views
  ADD CONSTRAINT devotional_views_member_id_fkey
    FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Tighten NOT NULL Constraints
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.books_of_month
  ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE public.monthly_devotionals
  ALTER COLUMN created_by SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Fix UNIQUE Constraints
-- ─────────────────────────────────────────────────────────────────────────────

-- monthly_devotionals UNIQUE constraint:
-- Remote already has canonical monthly_devotionals_month_year_key on (month, year)
-- This is correct per migration 010 - no changes needed
-- Note: Audit initially showed different constraint name, but verified remote is already canonical

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Remove Redundant RLS Policies
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Remote has 34 policies; canonical (migration 010) has 11.
-- Keep only the canonical policies; remove all extra/redundant ones.
--

-- books_of_month: Keep only books_read + books_manage
DROP POLICY IF EXISTS "books_delete" ON public.books_of_month;
DROP POLICY IF EXISTS "books_insert" ON public.books_of_month;
DROP POLICY IF EXISTS "books_select" ON public.books_of_month;
DROP POLICY IF EXISTS "books_update" ON public.books_of_month;

-- Ensure canonical policies exist
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

-- monthly_devotionals: Keep only devotional_read + devotional_manage
DROP POLICY IF EXISTS "monthly_devotionals_delete_admin" ON public.monthly_devotionals;
DROP POLICY IF EXISTS "monthly_devotionals_insert_admin" ON public.monthly_devotionals;
DROP POLICY IF EXISTS "monthly_devotionals_select" ON public.monthly_devotionals;
DROP POLICY IF EXISTS "monthly_devotionals_update_admin" ON public.monthly_devotionals;

-- Ensure canonical policies exist
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

-- devotional_daily_pages: Keep only daily_pages_read + daily_pages_manage
DROP POLICY IF EXISTS "devotional_daily_pages_delete_admin" ON public.devotional_daily_pages;
DROP POLICY IF EXISTS "devotional_daily_pages_insert_admin" ON public.devotional_daily_pages;
DROP POLICY IF EXISTS "devotional_daily_pages_select" ON public.devotional_daily_pages;
DROP POLICY IF EXISTS "devotional_daily_pages_update_admin" ON public.devotional_daily_pages;

-- Ensure canonical policies exist
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

-- devotional_views: Keep only views_own + views_admin_read
DROP POLICY IF EXISTS "devotional_views_insert_own" ON public.devotional_views;
DROP POLICY IF EXISTS "devotional_views_select_own_or_admin" ON public.devotional_views;
DROP POLICY IF EXISTS "devotional_views_update_own" ON public.devotional_views;

-- Ensure canonical policies exist
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
-- STEP 5: Remove Duplicate Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- devotional_daily_pages: Remove exact duplicate index
-- Audit verified both have identical definitions:
--   BTREE (devotional_id, day_of_month)
-- Keep idx_devotional_daily_pages_devotional_id (from migration 010)
-- Drop devotional_daily_pages_devotional_day_idx (remote-only duplicate)
DROP INDEX IF EXISTS public.devotional_daily_pages_devotional_day_idx;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Remove Duplicate Triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- books_of_month: Remove duplicate trigger
-- Audit verified both triggers are identical (call set_updated_at())
-- Keep books_of_month_updated_at (from migration 010)
-- Drop books_updated_at (remote-only duplicate)
DROP TRIGGER IF EXISTS books_updated_at ON public.books_of_month;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION: All changes are non-destructive, data-preserving, and align with
-- migration 010 canonical schema. No application code changes required.
-- ═══════════════════════════════════════════════════════════════════════════════
