# Hosted comparison: migration history and policies (read-only)

**Scope.** Read-only inspection of the production project. Every statement is a `SELECT`, or a CLI read command. Nothing in this document writes to a database, applies a migration, repairs history, or changes a function, policy or secret.

**Who runs it.** A person with production access, in the Supabase SQL editor for the production project. Save each result exactly as returned (JSON or CSV), and send the files back for comparison.

## 1. Migration history

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

Compare with the canonical set:

```bash
node supabase/verification/check_migration_history.mjs hosted-history.json
```

Expected results, by case (see the round-2 report, section 2.4):
- **Case A.** 038 applied by hand with the meeting-audience check, not in history. Rows 000–037 present; 038 absent; 039–047 absent. Then apply 039, 040–044, 045, 046 and 047 through the approved path only.
- **Case B.** 038 not applied. Rows 000–037 present. Apply 038 (historical content, restored in this release), then 039–047.
- **Case C.** Any BSC migration recorded under its old number. **Stop.** Reconcile with a person before anything else.

## 2. Schema fingerprint and contract (read-only file)

Run `supabase/verification/schema_fingerprint.sql` in the production SQL editor. The file is a single read-only `SELECT`. Save the JSON output as `hosted-fp.json`, then:

```bash
node supabase/verification/check_schema_contract.mjs hosted-fp.json --golden supabase/verification/schema_fingerprint.golden.json
```

Every line must be `PASS`. A difference in `functions` or `policies` before 045 has been applied is expected only for the entries listed in the release report. Any other difference is a stop: investigate it, and do not regenerate the golden to match production.

## 3. Policy comparison

Run this query in the production SQL editor and save the result as `hosted-policies.txt` (pipe-separated, one row per policy):

```sql
-- READ-ONLY. Lists every RLS policy in public and storage, and the function definitions they call (by name only).
select schemaname, tablename, policyname, cmd, roles::text,
       regexp_replace(coalesce(qual, '-'), '\s+', ' ', 'g') as using_expr,
       regexp_replace(coalesce(with_check, '-'), '\s+', ' ', 'g') as check_expr
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;
```

Compare with the local reference, `docs/release-consolidation/local_reference_policy_dump.txt` (145 lines, from the final replay of 000–047):

```bash
diff <(sort docs/release-consolidation/local_reference_policy_dump.txt) <(sort hosted-policies.txt)
```

Expected: before 045, the differences are the policies in the release report, section 3. After 047 is applied to production, the two files must be identical.

## 4. Other read-only checks

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'events' order by 1;

select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.events'::regclass and contype = 'c' order by 1;

select to_regclass('public.fellowships') is not null as fellowships_exists,
       to_regclass('public.bscs') is not null as bscs_exists;
```

Expected for case A before any change: `events_meeting_audience_requires_meeting` present (039 not yet applied). After 039: absent.

Edge functions (CLI, read-only):

```bash
npx supabase functions list --project-ref <ref>
```

Expect `notify-event` deployed. Deployment of any function is out of scope for this document.

## 5. Stop conditions

Stop and do not apply migrations if any of these hold:
- history contains an unknown version, a renamed entry, a gap, or a BSC migration under an old number (`check_migration_history.mjs` exits 1);
- the schema contract reports a difference outside the release report's list;
- the policy diff contains a policy that is not in the release report;
- a backup has not been taken and confirmed.
