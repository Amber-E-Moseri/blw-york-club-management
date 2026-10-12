# Event notifications: production deployment runbook

Do not start these steps without explicit approval. Each step assumes the previous one succeeded.

**Status: NO-GO for production.** See "Production decision" at the end. Everything below was verified against a local
Supabase stack and the real Deno runtime. Nothing has been verified against the hosted project.

## Verified results (commit range on `claude/blw-york-hub-interview-n0pu2a`, after `1026740`)

| Check | Result | How it was run |
| --- | --- | --- |
| Migrations replay from empty | Pass | `supabase db reset --local` |
| Migration 038/039 re-run | Pass | Both re-run after an orphaned meeting audience exists |
| Migration 039 upgrade path | Pass | Old 038 from `a09adb8` applied, then 039 |
| Schema parity (golden) | **30/30** | `check_schema_contract.mjs` against the regenerated golden |
| Schema determinism | **30/30** | Two independent replays produce identical fingerprints |
| Parity negative control | Fails as it should | A changed function body is caught, then rolled back |
| SQL authorisation | release RLS 33/33, guard 32/32, active-guard 11/11, meeting attendance 9/9 | `supabase/verification/*.sql` |
| Auth, authorisation, email/push, storage | 12/12, 61/61, 36/36, 30/30 | `supabase/verification/*.mjs` |
| `notify-event`, in-process | **45/45** | `NOTIFY_MODE` unset |
| `notify-event`, Deno runtime | **45/45** | `NOTIFY_MODE=deno`, real `deno run` in Docker |
| Edge function security | **18/18** | `scripts/certify-edge-deno.sh` |
| P0 behavioural | **123/123** | `scripts/certify-edge-deno.sh` |
| P0 boundary | **44/44** | `scripts/certify-edge-deno.sh` |
| Jest | 245 passed, 11 skipped (256 total), 30 suites | `npm test` |
| TypeScript | Pass | `npm run typecheck` |
| Production build | Pass, no warnings | `npm run build` |
| Browser: functional | 14/14 | Playwright against `npm start` |
| Browser: Add Event modal | 80/80 | 5 viewports (375x667, 667x375, 768x1024, 1280x800, 1440x900) × light and dark |

The 45-check `notify-event` harness now includes a secret-exposure check: the VAPID private key and the service-role key
must not appear in any response body or runtime log.

## Gates

| Gate | Status | What clears it |
| --- | --- | --- |
| Schema golden (`schema_fingerprint.golden.json`) | **Regenerated and validated locally.** Changes: the `events` table (migration 038) and the two function hashes below. | Read-only fingerprint on the hosted project, then compare (see "Hosted read-only checks"). |
| Function hashes `is_active_profile`, `find_person_by_email` | Explained: the golden had CRLF line endings in these bodies. The SQL is identical. The fingerprint now strips CR before hashing, and `.gitattributes` forces LF for `supabase/`. | Hosted fingerprint must match the LF value. |
| `notify-event` in the Deno runtime | Pass, 45/45 | Done locally. |
| Edge security and P0 in the Deno runtime | Pass | Done locally. |
| Hosted project | **Not verified.** | Read-only checks below, then a smoke test on a separate test project. |
| PR #5 (`integration/blwyork-release-reconciliation`) | **Open, diverges from this branch.** | Reconcile before merge (see below). |
| Gateway JWT check (`verify_jwt`) | Not covered by any local test. | Smoke test on the hosted project. |

## Hosted project state (from PR #5's description, not verified here)

PR #5 states that these were done by hand on the hosted project `rjtstjmtddqhesexltbj`:
- Migration 038 applied through the SQL editor. That copy of 038 **includes the meeting-audience check constraint**. Deleting a
  meeting used as an audience fails on that database until 039 is applied.
- `notify-event` deployed.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` set as function secrets.
- `REACT_APP_VAPID_PUBLIC_KEY` set in Vercel.

Treat these as claims until the read-only checks confirm them. If they hold, the remaining schema step is **039 only**.

## Hosted read-only checks (run before any change)

Run only SELECT statements. `schema_fingerprint.sql` is read-only.

1. Confirm migration history: `npx supabase migration list --project-ref <ref>`.
2. Columns and constraints on `events`:
   ```sql
   select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'events' order by 1;
   select conname, pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.events'::regclass and contype = 'c';
   ```
   Expect `audience`, `audience_meeting_id` and `notified_at`. If `events_meeting_audience_requires_meeting` is listed, 039 is needed.
3. `push_notification_log` columns. Expect `sent_at` and `response_data`, and no `error_message` or `target_url`:
   ```sql
   select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'push_notification_log' order by 1;
   ```
4. Full fingerprint, compared with the golden. Run the read-only file against the hosted project, save the JSON, then compare.
   Use the SQL editor, or `npx supabase db query --linked` if your CLI version supports the linked project (check with
   `npx supabase db query --help`). Then:
   ```bash
   node supabase/verification/check_schema_contract.mjs hosted-fp.json --golden supabase/verification/schema_fingerprint.golden.json
   ```
   Every line must be `PASS`.
   A difference in `functions` means the hosted function body is not the one the migrations produce. Inspect that
   function before deciding anything. Do not regenerate the golden to match the hosted value.
5. `npx supabase functions list --project-ref <ref>`: confirm `notify-event` is deployed and its version.

## Deployment order (once the gates clear and deployment is approved)

1. Back up the hosted database (point-in-time recovery or a logical dump) and record the current migration version.
2. Run the read-only checks above. Stop if anything unexpected appears.
3. Apply the schema:
   - If 038 is not yet applied: `npx supabase db push --project-ref <ref>` (applies 038, then 039).
   - If 038 was applied by hand (PR #5 note): apply only 039, the same way.
   - Both are safe to re-run.
4. Set the function secrets (below).
5. Deploy the function: `npx supabase functions deploy notify-event --project-ref <ref>`. Keep `verify_jwt` at its default.
6. Build and deploy the front end with the public VAPID key in the hosting environment. Redeploy after setting it.
7. Smoke test on a **separate test project first**, then on production with an approved test account and one test device only.
   Create an event with "All active members". Confirm one push on the test device, one row in `push_notification_log`, and
   a refused second send. Do not notify real members.

## Environment variables and secrets

| Name | Where | Notes |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Supabase function secret | Same value as `REACT_APP_VAPID_PUBLIC_KEY`. |
| `VAPID_PRIVATE_KEY` | Supabase function secret | Never commit it or put it in the front end. |
| `VAPID_SUBJECT` | Supabase function secret | A `mailto:` contact URL. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Provided by the Edge runtime | Do not set manually. |
| `REACT_APP_VAPID_PUBLIC_KEY` | Hosting build environment | Redeploy after changing it. |
| `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` | Hosting build environment | Public by design. |

```bash
npx supabase link --project-ref <ref>
npx supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:<contact>
```

Generate keys once with `node scripts/generate-vapid-keys.js`. Changing keys invalidates every existing subscription.

**Protection of secrets, as verified:**
- Generated certification secrets are written to temporary directories with mode `600`, outside the repository, and removed on exit.
- `.gitignore` covers `.env`, `.env.local` and `supabase/functions/.env`.
- The secret-exposure check in `notify_event_certification.mjs` fails if the VAPID private key or the service-role key appears
  in a response body or in the runtime log.

## Reproducing the certification locally

```bash
npx supabase start --ignore-health-check   # if health checks are slow in your environment
npx supabase db reset --local
# parity, SQL and JavaScript harnesses: see scripts/certify-local.sh
# notify-event in the Deno runtime (needs Docker):
NOTIFY_MODE=deno NOTIFY_CA_BUNDLE=<pem> node supabase/verification/notify_event_certification.mjs
# edge-dependent harnesses through the Deno router (needs Docker):
NOTIFY_CA_BUNDLE=<pem> ./scripts/certify-edge-deno.sh
```

`NOTIFY_CA_BUNDLE` is only needed where outbound HTTPS is intercepted. Leave it unset where the runtime trusts the public roots.

`scripts/certify-local.sh` still uses `supabase functions serve` for its edge step. That needs a networked edge runtime, which
CI has. Where it does not, use `scripts/certify-edge-deno.sh`.

## Rollback

- **Front end:** redeploy the previous build.
- **Function:** `npx supabase functions delete notify-event --project-ref <ref>`. Events still save, and the form reports the failure.
- **Schema:** 038 and 039 are additive. Leave them in place. Dropping the columns would lose audience data.

## Known limits

- Deliveries are not retried. A failed device is logged, and the event is not re-sent automatically.
- An event whose meeting was deleted keeps audience `meeting` with no meeting. `notify-event` refuses it and sends nothing.
- `notify-event/index.ts` is not type-checked, because Deno imports sit outside the project's TypeScript check. It is verified
  by running it.
- The gateway's JWT check is not covered locally.
- The `extensions` section of the golden lists `pg_net`, a platform extension the local replay does not create. The contract
  checker does not compare that section, so this is unverified.
- The edge router and the notification harness use an import map that maps `esm.sh/@supabase/supabase-js@2.45.0` to the npm
  package of the same version. Production uses `esm.sh`. The two are the same package version, but this is an equivalence
  assumption, not a tested fact.

## Reconciling PR #5

PR #5 (`integration/blwyork-release-reconciliation`) and this branch have separate histories. They share `a09adb8`, and PR #5
then diverges. It contains:
- a golden commit that regenerated only the `events` lines (eb7b4bb), leaving the function hashes unresolved;
- a migration 038 with the meeting-audience constraint and no 039;
- other changes to notification code and tests, including a different `notify-event`.

Do not merge PR #5 as it stands. Choose one history. The migrations and harnesses on this branch are the ones verified here.

## Production decision

**NO-GO.** Blockers, with the evidence needed to clear each:

1. **Hosted state unverified.** Run the read-only checks above on the hosted project and attach the output. Confirm the
   fingerprint matches the golden.
2. **Hosted schema needs 039** if 038 was applied by hand. Evidence: the constraint query in check 2 returns no
   `events_meeting_audience_requires_meeting`, or 039 has been applied and verified.
3. **No hosted test project.** Provide a separate Supabase test project (URL, anon key, service-role key kept out of the repo)
   and run the browser and notification checks there, including a real device.
4. **Gateway JWT path.** Evidence: a call to the deployed `notify-event` without a token returns 401 from the gateway, and a
   member's token returns 403 from the function.
5. **PR #5 reconciled** into one history, with the golden regenerated from that history.
6. **Approval** to deploy, which I do not have.

Once 1–5 are met and 6 is given, the local evidence above supports a GO for a controlled rollout to a test project first.
