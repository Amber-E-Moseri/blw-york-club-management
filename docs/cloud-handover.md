# Cloud development handover

Purpose: give a cloud coding agent the complete project state, so it can continue without local context. GitHub is the
authoritative source of implementation state. This document contains no credentials and no database exports.

Status at writing: production HOLD remains in effect. The release is not approved.

## 1. Repository and state

- Repository: `Amber-E-Moseri/blw-york-club-management`
- Working branch: `remediation/blw-york-wave1-5`
- Open PR: #97 (draft), https://github.com/Amber-E-Moseri/blw-york-club-management/pull/97
- Checkpoint before reconciliation: commit `5e8c6bf`, tag `checkpoint/pre-reconciliation-5e8c6bf`
- Second local worktree: `BLW-York-Hub-hotfix` on `hotfix/p0-login-null-response` at `25e9673`. Clean, not touched by the
  database work. Do not write to it from the cloud session.
- Single-writer rule: only one agent writes to the unified worktree at a time. Do not run two writers on the same files.

## 2. Architecture decisions (binding)

- Stack: Next.js 14 App Router (CRA-built hub at `/hub`), TypeScript strict, Supabase (Postgres, RLS, Edge Functions,
  Google OAuth only), Zod on every write path, Vercel hosting, Sentry.
- Write pipeline: Client, then Zod validation, then RLS authorization, then DB transaction, then RAF engine, then write,
  then response. Financial mutations happen only inside a DB transaction.
- Deterministic financial logic lives in `lib/raf/`. Import pipeline in `lib/imports/`. Merchant rules in
  `lib/merchant-rules/`. Not in route handlers or components.
- Money is `Decimal(12,2)`, returned as strings. Allocation percents are fractions that sum to `1.0000 ± 0.0001`. Rounding
  remainders go to `buffer` (allocations) or `emergency_fund` (surplus).
- Debt balances are derived from payment history, never stored.
- `period_start_day` must not be 29, 30 or 31. A debt with payments cannot be deleted (return 422; set inactive).
- Negative amounts are allowed only for `direction = 'credit'`.
- Service worker: Hub worker scope is `/hub/`. `public/sw.js` is a kill switch. Legacy paths are
  `['/sw.js', '/service-worker.js']`.
- `WEBSITE_TRUSTED_PROXY` stays unset. Deployment requirement documented in `docs/production-readiness.md` section 5.
- Golden fingerprint `supabase/verification/schema_fingerprint.golden.json` is regenerated only from PostgreSQL 17, never
  from PGlite.

## 3. Migration sequence and lineages

There are two migration lineages. Treat them as separate sources until reconciliation says otherwise.

- HEAD lineage: `supabase/migrations/000` to `059`. This is what the unified golden fingerprint describes. It includes the
  ROR and BSC objects in `039_ror_reading_streaks.sql`, `040_bscs.sql`, `041_message_audience_targeting.sql`,
  `042_bsc_contact_visibility.sql`, `043_get_ror_streak_authz.sql` and `044_bsc_access_hardening.sql`.
- Source lineage `e315ace` (website CMS and audience line): 000 to 116. It shares names with HEAD for 000 to 038. It
  diverges at merge-base `a09adb8`. Its `039` is `039_event_audience_meeting_delete.sql`.
- The two lineages must be reconciled explicitly. Replaying only one of them cannot reproduce the other's objects. Phase A
  documentation (`docs/db-reconciliation-phase-a.md`, "Source lineage correction") records this.

Hosted state (as known from evidence, not re-verified here):

- Preview: ledger 000 to 099. Schema matches the `e315ace` lineage (76 public relations, 142 non-system functions, 95
  triggers, 160 policies). It includes 24 Preview-only tables that are approved and must be preserved.
- Production: ledger 000 to 099 with matching names and statement hashes, but the schema differs. 55 public relations, 63
  functions, 40 triggers, 131 policies. It contains the HEAD-lineage ROR and BSC objects, and it lacks 22 of the approved
  Preview tables. It also has `contacts_bsc_view` (not in either lineage) and 12 columns missing on shared tables.
- Unified golden: 64 relations, 84 functions, 000 to 059. Neither hosted database matches it.

Do not apply unified migrations to Preview or Production. Do not repair ledgers. Do not reset anything.

## 4. Environment setup for a cloud agent

Prerequisites:

- Node 22.x (the local machine has v22.12.0 and npm 10.9.0).
- Git.
- PostgreSQL 17 for authoritative checks (CI runs PG17). PGlite is preliminary only.
- Playwright browsers for the frontend end-to-end suites.

Commands. Run in order from the repository root:

```powershell
npm ci
npm --prefix site ci
npx playwright install chromium webkit
```

On Git Bash, prefix commands that pass `PUBLIC_URL=/` or `PROD_MOUNT=/hub` with `MSYS_NO_PATHCONV=1`. Otherwise MSYS
rewrites them into Windows paths.

Database checks (PGlite-based, preliminary):

```powershell
npm run test:db:contract
npm run test:db:authz
npm run test:db:attendance
npm run test:db:membership
npm run test:db:website
```

`openReplay(migrationsDir, { lastFile })` is the replay entry point in `supabase/verification/pglite_replay.mjs`. The
PGlite module path must be provided through `PGLITE_MODULE`.

Authoritative local rehearsal (PostgreSQL 17, scratch database only, no Docker):

```powershell
.\supabase\verification\rehearsal\run-pg17-rehearsal.ps1 -PgBin "C:\Program Files\PostgreSQL\17\bin" -Port 54317 -Scratch "<path outside the repo>"
```

The script replays `000` to `059` into a scratch database and runs the schema contract against the golden. It writes to
the scratch directory only. It does not touch hosted projects or the ledger.

Frontend and browser suites:

```powershell
npm run build:hub
npm run build:site
npm run verify:routes
npm run e2e:production
npx playwright test -c playwright.prefix.config.ts
```

`playwright.prefix.config.ts` sets `PROD_MOUNT=/hub`. Its WebKit project is the one that stalls (see section 6).

Git on Windows: do not commit `deno.lock` files. Remove stray lockfiles before committing.

## 5. Evidence files and secure access

Required, and not in the repository:

- `blwyork-preview-evidence.json`
- `blwyork-production-evidence.json`

These are schema exports from the hosted databases. They are kept locally in `C:\Users\moser\Downloads\`. They must never be
committed or pasted into chat or PR text. The cloud agent needs them only if it must re-run the Phase A comparison.
Provide them through the owner's approved channel, and load them from a path outside the repository. Store them with
restricted access.

Credentials:

- Hosted Supabase access (project URL, service keys, database connection strings) is held by the owner. It is not in the
  repository and must not be placed in it. `.env.example` lists variable names only.
- Do not use hosted credentials from a cloud agent unless the owner grants a specific, time-limited task.
- Google OAuth client secrets, Sentry DSNs and SMTP credentials are owner-held.

## 6. Test results

Results recorded in the repository (`docs/production-readiness.md`). These were not re-run for this handover unless noted:

- Hotfix production-build suite: passing.
- Migration 059 authorization suite: 37 of 37.
- Schema contract: 29 of 29 against the golden, PG17.
- Prefix-mounted Chromium project: passing.
- Desktop WebKit prefix project: stalls. The Hub page with an active service worker hangs on desktop WebKit. Not a CDN problem,
  not a fetch-handler problem, and not reproduced on a blank page. Root cause unresolved. This is a final release blocker.
- Phase A (read-only gap analysis): complete for the evidence comparison. The source-lineage correction is recorded. The
  Production drift cause against the HEAD lineage has not been run.

## 7. Outstanding blockers

1. Desktop WebKit service-worker stall on the prefix-mounted Hub. Open. Requires a fix or an explicit approved disposition.
2. Phase A is incomplete. The Production drift (20 tables, 12 columns, about 80 functions) has not been compared against
   the HEAD lineage replay. `contacts_bsc_view` has no source in either lineage.
3. Phase B (forward-only reconciliation) has not started. It needs the owner's confirmation of scope and of how the two
   lineages are combined.
4. Phase C (certification of fresh install and of upgrades from the Preview and Production baselines) has not started.
   PG17 CI is authoritative. The hosted-stack certification in `supabase/verification/README.md` is still to be done.
5. Attendance records that are ambiguous, and duplicate identities, are not yet reported. Preserve original values. Do not
   merge identities.
6. Daily Bread mass organisation: the owner has not chosen between the three readings (bulk edit of an existing month, bulk
   organise of the list, bulk re-run of detection). Do not build until chosen.
7. Hosted evidence transfer is owner-held (section 5).

## 8. Exact next actions

1. Confirm the branch is `remediation/blw-york-wave1-5` and that HEAD equals `origin/remediation/blw-york-wave1-5`.
2. Install dependencies (section 4) and run `npm run test:db:contract` and `npm run test:db:authz`.
3. Run the PG17 rehearsal for `000` to `059` and confirm 29 of 29 contract checks.
4. Replay the `e315ace` lineage (000 to 116) and the HEAD lineage (000 to 059) separately in scratch databases. Record the
   object diff for each. Do not merge the two.
5. Compare the Production evidence against the HEAD-lineage replay. Identify the cause of each of the 20 tables, 12 columns
   and about 80 functions. Record the cause in `docs/db-reconciliation-phase-a.md`.
6. Write a decision list for the owner: the lineage merge approach, `contacts_bsc_view`, the Production column gaps, and
   the attendance and duplicate-identity reports. Stop there and wait for the owner.
7. Investigate the desktop WebKit stall under `playwright.prefix.config.ts`. Do not weaken assertions. Document the result in
   `docs/production-readiness.md` section 0a.
8. Do not deploy, merge, force-push, run Docker, change hosted migrations or ledgers, or reset any database.

## 9. Local process state at handover

- Scratch PostgreSQL cluster from earlier replays: not running (verified with `pg_ctl status`).
- Windows services `postgresql-x64-17` and `postgresql-x64-18` are installed and running. They are system services, not
  started by this work. Do not stop them.
- Two `node.exe` processes belong to the OpenAI Codex application, not this work. Left running.
- No development servers are listening on ports 4173, 4174, 4183, 4184, 54317 or 54318.
