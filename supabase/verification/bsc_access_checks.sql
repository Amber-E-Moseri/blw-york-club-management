-- bsc_access_checks.sql
-- READ-ONLY. Run in the Supabase SQL Editor after migrations 040 through 044 (the BSC set; 038 and 039 are event notifications).
-- Returns one row per check: PASS or FAIL, with a short detail. Nothing is written.
-- Checks that a member's data can only be seen through the BSC/cell rules is covered by the
-- behavioural checks in the local certification harness; this file checks the database shape.

with results as (
  -- Tables and columns
  select 'table fellowships exists' as item,
         exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'fellowships') as ok
  union all
  select 'table bscs exists',
         exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'bscs')
  union all
  select 'cells.fellowship_id column exists',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cells' and column_name = 'fellowship_id')
  union all
  select 'profiles.bsc_id column exists (one BSC per member)',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'bsc_id')

  -- Row-level security on the new tables
  union all
  select 'RLS enabled on fellowships',
         coalesce((select relrowsecurity from pg_class where oid = 'public.fellowships'::regclass), false)
  union all
  select 'RLS enabled on bscs',
         coalesce((select relrowsecurity from pg_class where oid = 'public.bscs'::regclass), false)

  -- Policies that carry the leader rules
  union all
  select 'devotional_views reads use can_view_member',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'devotional_views'
                 and policyname = 'devotional_views_select_own_or_admin' and qual like '%can_view_member%')
  union all
  select 'confession_declarations reads use can_view_member',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'confession_declarations'
                 and policyname = 'confession_declarations_read_scoped' and qual like '%can_view_member%')
  union all
  select 'habit_entries reads do NOT extend to leaders (no can_view_member)',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habit_entries'
                     and qual like '%can_view_member%')

  -- Helper functions and their grants
  union all
  select 'function can_view_member exists',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'can_view_member')
  union all
  select 'function is_bsc_leader_of exists',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'is_bsc_leader_of')
  union all
  select 'function bsc_members_visible exists',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'bsc_members_visible')
  union all
  select 'bsc_members_visible is not executable by anon',
         not has_function_privilege('anon', 'public.bsc_members_visible()', 'EXECUTE')
  union all
  select 'bsc_members_visible is executable by authenticated',
         has_function_privilege('authenticated', 'public.bsc_members_visible()', 'EXECUTE')

  -- Assignment guard (members cannot move themselves)
  union all
  select 'trigger profiles_guard_bsc_assignment exists',
         exists (select 1 from pg_trigger where tgname = 'profiles_guard_bsc_assignment'
                 and tgrelid = 'public.profiles'::regclass)
  -- Table grants (migration 042): without these, every BSC query fails with "permission denied"
  union all
  select 'authenticated can read and write bscs (grants)',
         has_table_privilege('authenticated', 'public.bscs', 'SELECT')
           and has_table_privilege('authenticated', 'public.bscs', 'INSERT')
  union all
  select 'authenticated can read fellowships (grants)',
         has_table_privilege('authenticated', 'public.fellowships', 'SELECT')
)
select
  item,
  case when ok then 'PASS' else 'FAIL' end as result
from results
order by result desc, item;
