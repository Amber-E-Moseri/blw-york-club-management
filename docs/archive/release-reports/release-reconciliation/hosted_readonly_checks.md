# Hosted read-only checks (Phase 2)

Run these in the Supabase SQL editor for the **production** project, one block at a time. Every statement is a
`SELECT`. Nothing here changes data. This file is Markdown on purpose: the repository's guard forbids executable
`.sql` files outside `supabase/migrations`.

```sql
-- Purpose: decide which migrations are already applied on hosted, and whether event 038 was applied by hand
-- with the meeting-audience check (in which case only 039 is needed) before any migration is run.

-- 1. Migration history as Supabase records it. Expected from the runbook: 001-037 present, 038 possibly absent
--    (applied by hand), 039 absent, and no 040-044 rows at all.
select version, name
from supabase_migrations.schema_migrations
order by version;

-- 2. Does the BSC schema exist on hosted under any name? (Fellowships, BSCs, profiles.bsc_id.)
select
  to_regclass('public.fellowships') is not null as fellowships_exists,
  to_regclass('public.bscs') is not null        as bscs_exists,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles' and column_name = 'bsc_id') as profiles_bsc_id_exists;

-- 3. Notification columns on events (expect audience, audience_meeting_id, notified_at).
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'events'
order by 1;

-- 4. Check constraints on events. If events_meeting_audience_requires_meeting is listed, migration 039 is needed.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.events'::regclass and contype = 'c'
order by conname;

-- 5. The two BSC read policies that migration 044 replaces. Shows whether hosted still has the
--    "any signed-in account" form. Expect nothing (the tables should not exist yet).
select schemaname, tablename, policyname, qual
from pg_policies
where schemaname = 'public' and tablename in ('bscs', 'fellowships')
order by tablename, policyname;

-- 6. Edge function deployment is checked with the CLI, not SQL:
--      npx supabase functions list --project-ref <ref>
--    Expect notify-event to be deployed.
```

Paste the results back into the release thread before any migration is run.
