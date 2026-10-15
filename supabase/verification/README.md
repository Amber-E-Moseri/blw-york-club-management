# Release certification

Everything here runs against a **local** Supabase stack with fake data. Nothing touches a hosted project. The behavioural
harnesses refuse to run unless `SUPABASE_URL` is `127.0.0.1` / `localhost`, use random per-run passwords, and delete
every account they create.

## One-time setup

```bash
npx supabase start
eval "$(npx supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL)=')"
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_FUNCTIONS_URL="$API_URL/functions/v1"
DB=supabase_db_<project_id>        # the database container, e.g. supabase_db_BLW_York
```

## Order

1. **Replay from empty** (no manual SQL, no shim): `npx supabase db reset --local`
   - must apply every migration `000 … latest` without error.
2. **Fingerprint + contract**
   ```bash
   docker exec -i $DB psql -U postgres -At -q < supabase/verification/schema_fingerprint.sql > fp1.json
   node supabase/verification/check_schema_contract.mjs fp1.json --golden supabase/verification/schema_fingerprint.golden.json
   ```
   Every line must be `PASS`. This asserts: exact table/function/view/policy inventory, RLS on every table, `anon` has
   nothing, no `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN`, the exact `authenticated` privilege matrix, exact function
   `EXECUTE` grants and pinned `search_path`, the `profiles` policy allow-list and guard trigger, the `user_id`
   identity contract, the exact Storage buckets/policies, and equality with the golden fingerprint.
3. **Database-level harnesses**
   ```bash
   docker exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 < supabase/verification/release_rls_people_certification.sql
   docker exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 < supabase/verification/guard_approval_bootstrap_certification.sql
   ```
   Every row `PASS`, `failures = 0`. Both roll back.
4. **Behavioural harnesses (real API, real accounts)**
   ```bash
   node supabase/verification/auth_workflow_certification.mjs
   node supabase/verification/authorization_certification.mjs
   node supabase/verification/email_push_certification.mjs
   node supabase/verification/storage_certification.mjs
   ```
5. **Edge Functions** (needs the local function runtime with throwaway secrets; the secrets are generated per run and
   passed by environment only, never written to the repository)
   ```bash
   CRON=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
   UNSUB=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
   printf 'EMAIL_CRON_SECRET=%s\nUNSUBSCRIBE_SECRET=%s\n' "$CRON" "$UNSUB" > /tmp/edge.env      # outside the repo
   npx supabase functions serve --env-file /tmp/edge.env &       # leave running
   CERT_CRON_SECRET="$CRON" CERT_UNSUBSCRIBE_SECRET="$UNSUB" node supabase/verification/edge_function_security_certification.mjs
   ```
   No real email is sent: authorised callers stop at the "provider not configured" boundary.
6. **Application:** `npx tsc --noEmit`, `CI=true npm test`, `npm run build`, then the browser smoke at 1280, 768 and 375 px:
   ```bash
   npx playwright test -c playwright.release.config.ts
   ```
7. **Second independent replay:** `npx supabase db reset --local` again, produce `fp2.json`, then
   `node supabase/verification/check_schema_contract.mjs fp2.json --same-as fp1.json`. It must be byte-identical.

## Files

| File | Purpose |
|---|---|
| `schema_fingerprint.sql` | read-only `SELECT` that returns one deterministic JSON description of the security-relevant schema |
| `schema_contract.json` | the reviewed contract (expected tables, privilege matrix, function grants, policy allow-lists, buckets) |
| `check_schema_contract.mjs` | asserts the contract on a fingerprint; optional `--golden` and `--same-as` comparisons |
| `schema_fingerprint.golden.json` | the fingerprint of the certified schema (regenerate when the schema legitimately changes) |
| `release_rls_people_certification.sql` | RLS and People lifecycle behaviour (rolled back) |
| `guard_approval_bootstrap_certification.sql` | privileged-column guard (with a rogue policy), database-enforced approval, first-admin bootstrap (rolled back) |
| `auth_workflow_certification.mjs` | signup, login, pending state, reset, logout |
| `authorization_certification.mjs` | signup trigger, escalation attempts, RPC and table surface |
| `email_push_certification.mjs` | `user_id` identity contract for preferences, subscriptions and the notification log |
| `storage_certification.mjs` | bucket limits and every allowed / refused upload, overwrite and delete |
| `edge_function_security_certification.mjs` | Edge Function authorization (no real email) |
| `lib.mjs` | shared helpers (local-only guard, random passwords, cleanup) |
| `014_verify_reconciliation.sql` | historical reconciliation check for the prototype's drifted database |

## Changing the schema legitimately

Add a forward migration, update `schema_contract.json` in the same commit if a table, function, privilege or policy set
changes, regenerate `schema_fingerprint.golden.json` from a fresh replay, and re-run steps 1–7. A schema change that is
not reflected in the contract fails the gate on purpose.
