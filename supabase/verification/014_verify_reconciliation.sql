-- ═══════════════════════════════════════════════════════════════════════════════
-- Verification Script: Growth & Foundation Schema Reconciliation (Migration 014)
-- Run this AFTER applying migration 014 to verify successful reconciliation
-- ═══════════════════════════════════════════════════════════════════════════════

-- SECTION A: TABLE EXISTENCE & STRUCTURE
SELECT
  'A. Table Existence' as section,
  table_name,
  CASE WHEN table_schema = 'public' THEN 'EXISTS' ELSE 'MISSING' END as status
FROM information_schema.tables
WHERE table_name IN (
  'monthly_devotionals', 'devotional_daily_pages', 'devotional_views',
  'books_of_month', 'prayer_requests',
  'foundation_school_classes', 'foundation_school_enrollments', 'foundation_school_progress'
)
ORDER BY table_name;

-- SECTION B: FK REFERENCES — ALL SHOULD TARGET profiles (NOT auth.users)
SELECT
  'B. Foreign Key Targets' as section,
  tc.table_name,
  kcu.column_name,
  ccu.table_name as referenced_table,
  pg_get_constraintdef(c.oid) as constraint_definition
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN pg_constraint c ON c.conname = tc.constraint_name AND c.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = tc.table_schema)
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN (
    'books_of_month', 'monthly_devotionals', 'devotional_views',
    'prayer_requests', 'foundation_school_enrollments', 'foundation_school_progress'
  )
ORDER BY tc.table_name, kcu.column_name;

-- SECTION C: NULLABILITY — created_by should NOT be nullable
SELECT
  'C. Nullability Check' as section,
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('books_of_month', 'monthly_devotionals')
  AND column_name = 'created_by'
ORDER BY table_name;

-- SECTION D: UNIQUE CONSTRAINTS — monthly_devotionals should have (month, year) ONLY
SELECT
  'D. Unique Constraints' as section,
  tc.table_name,
  tc.constraint_name,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'UNIQUE'
  AND tc.table_name IN (
    'monthly_devotionals', 'devotional_daily_pages',
    'devotional_views', 'foundation_school_enrollments', 'foundation_school_progress'
  )
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name, tc.constraint_name;

-- SECTION E: INDEXES — Verify duplicates removed
SELECT
  'E. Indexes' as section,
  tablename as table_name,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'monthly_devotionals', 'devotional_daily_pages', 'devotional_views',
    'books_of_month', 'prayer_requests',
    'foundation_school_classes', 'foundation_school_enrollments', 'foundation_school_progress'
  )
ORDER BY tablename, indexname;

-- SECTION F: TRIGGERS — Verify duplicates removed
SELECT
  'F. Triggers' as section,
  trigger_name,
  event_object_table as table_name,
  action_timing,
  pg_get_triggerdef(t.oid) as trigger_definition
FROM information_schema.triggers it
JOIN pg_trigger t ON t.tgname = it.trigger_name
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- SECTION G: RLS STATE — All tables should have RLS enabled
SELECT
  'G. RLS Enabled' as section,
  t.tablename as table_name,
  (SELECT relrowsecurity FROM pg_class WHERE relname = t.tablename AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) as rls_enabled
FROM (
  SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename IN (
      'monthly_devotionals', 'devotional_daily_pages', 'devotional_views',
      'books_of_month', 'prayer_requests',
      'foundation_school_classes', 'foundation_school_enrollments', 'foundation_school_progress'
    )
) t
ORDER BY t.tablename;

-- SECTION H: RLS POLICY COUNT — Should be 11 (canonical)
SELECT
  'H. RLS Policies' as section,
  tablename as table_name,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'monthly_devotionals', 'devotional_daily_pages', 'devotional_views',
    'books_of_month', 'prayer_requests',
    'foundation_school_classes', 'foundation_school_enrollments', 'foundation_school_progress'
  )
GROUP BY tablename
ORDER BY tablename;

-- SECTION I: CANONICAL POLICIES PRESENT
SELECT
  'I. Canonical Policies' as section,
  tablename as table_name,
  policyname,
  cmd as command
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'monthly_devotionals', 'devotional_daily_pages', 'devotional_views',
    'books_of_month', 'prayer_requests',
    'foundation_school_classes', 'foundation_school_enrollments', 'foundation_school_progress'
  )
ORDER BY tablename, policyname;

-- SECTION J: is_devotional_admin() FUNCTION STATUS
SELECT
  'J. Legacy Function' as section,
  proname as function_name,
  prosecdef as security_definer,
  'RETAINED FOR COMPATIBILITY' as status
FROM pg_proc
WHERE proname = 'is_devotional_admin'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXPECTED RESULTS SUMMARY:
--
-- A. All 8 tables should exist
-- B. All FKs should reference public.profiles (NOT auth.users)
-- C. created_by columns should NOT be nullable
-- D. monthly_devotionals should have UNIQUE (month, year) ONLY
-- E. No duplicate indexes (devotional_daily_pages_devotional_day_idx should be GONE)
-- F. No duplicate triggers (books_updated_at should be GONE)
-- G. All 8 tables should have RLS enabled = true
-- H. Total policy count = 11 (reduced from 34)
-- I. Only canonical policies should exist
-- J. is_devotional_admin() function should exist (deprecated but retained)
--
-- ═══════════════════════════════════════════════════════════════════════════════
