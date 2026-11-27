# Cloud development handover: BLW York unified platform, database reconciliation

Status as of the handover checkpoint. GitHub is the authoritative record of implementation state. This document is
written so a cloud coding agent can continue without access to the originating machine.

## 1. Authority and rules that remain binding

- **Production: HOLD.** No production writes, migrations, deployments or merges. Production is a live system.
- **Single writer.** One agent owns the unified worktree and the database reconciliation at a time. Do not run a second
  writer against the same branch.
- **Preserve:** existing accounts, profiles, people, memberships, contacts, attendance, leadership assignments and
  historical records. Preserve PR #97 (unified branch) and PR #98 (standalone login hotfix) as independent PRs.
- **Forbidden without a fresh owner approval:** Docker, new branches or worktrees, force pushes, hosted migrations,
  database resets, ledger repairs or edits, merges, production deployments.
- **No secrets in the repository, in logs or in chat.** No credentials, anon or service keys, passwords, or database
  exports are committed. Evidence files stay outside the repository (see section 7).
- **No general audits.** Work in bounded increments, each ending in a verified checkpoint and a report.

## 2. Settled architectural decisions (do not reopen)

1. The full approved feature set is the target. Preview and Production must converge on it. No permanent feature
   subsets.
2. The 24 Preview-only tables and their approved functionality are preserved. Nothing is dropped or renamed to converge.
3. Money is `Decimal(12,2)`. Allocation fractions are stored as `0.1000 = 10%`, and active percents sum to 1.0000 ±
   0.0001.
4. Debt balances are derived from payment history, never stored or edited.
5. Attendance: preserve original values. Ambiguous or incompatible rows are flagged for manual review. Do not
   fabricate statuses, delete records or auto-classify history. The target status set is
   `invited, confirmed, attended, absent, excused` (Production currently lacks the five-state check).
6. Identity: detect and report possible duplicates. No automatic merges.
7. BSC authorization uses the least-privilege scoped model. Do not restore the broad `bscs_manage` policy where it
   conflicts with the scoped model. Preserve the ROR and BSC helper functions and the approved contact visibility.
8. Membership: do not adopt `organizational_member_directory` as written, because it exposes email and phone to ordinary
   members. Preserve directory functionality without exposing private contact details. `membership_reconciliation_review`
   is admin-only (`security_invoker`), with positive and negative authorization tests.
9. Edge Functions must not trust `x-forwarded-for` on the hosted lineage. Use `trustedClientAddress(trustedProxy,
   headers)` with `WEBSITE_TRUSTED_PROXY=cloudflare`. This port is not yet done (see section 6).
10. Migrations 000–099 are preserved without modification. New work is forward-only, numbered after the existing
    sequence, and never renumbers history.

## 3. Repository and branch state

| Item | Value |
|---|---|
| Unified branch | `remediation/blw-york-wave1-5` (PR #97), HEAD recorded at handover |
| Standalone hotfix | `hotfix/p0-login-null-response` at `25e9673` (PR #98, draft, independent) |
| CMS / audience lineage | `origin/cert/website-d2-50f8aaa` (migrations up to `110_web_media_verification.sql`) |
| Other lineage refs | `origin/feat/website-cms-integ-106` (`e315ace`), `origin/golden/reconcile-schema-105`, `origin/integ/blwyork-unified-candidate` |

Recent commits on the unified branch, newest first: `6801fd9` (Phase A gap analysis doc), `339040b` (Drive thumbnail
fix), `9968439` (readiness doc), `ea29630` (devotional page ranges), `91d9c94` (prefix-mounted browser tests),
`168e3d5` (desktop header grid).

**Important:** the unified branch's migrations end at `059_web_role_non_empty_permissions.sql` (60 files, 000–059).
The CMS and audience migrations (059–110) exist only on the cert lineage above. Reconciling those two lineages is
the core open task (section 6).

## 4. Migration sequence and what is proven

- **Unified branch:** 000–059, 60 files in `supabase/migrations/`.
- **Local PostgreSQL 17.11 replay from empty (scratch database with Supabase stubs):** 60 of 60 applied.
- **Schema contract on that replay:** 29 of 30 checks pass. The failing check is
  `parity: schema fingerprint equals the golden fingerprint`, section `functions`. All 84 functions match on
  owner, EXECUTE grants, security mode, pinned search_path and volatility. 79 of 84 differ only in
  `definition_md5`. The cause is not yet established (section 6).
- **Not yet proven:** the Preview-only and Production-only objects, the 059–110 lineage, and any three-path
  certification.

Hosted evidence (read-only, collected and accepted as preliminary structural evidence):
- Preview: 76 public relations, 142 functions, 95 triggers.
- Production: 55 public relations, 63 functions, 40 triggers.
- Unified golden: 64 relations, 84 functions.
- Both hosted ledgers record 000–099 with matching names and statement hashes, yet the schemas differ. Preview and Production
  therefore differ from the ledgers and from each other. Do not trust a ledger entry as proof of applied SQL.

## 5. Test results recorded in this session

| Check | Result |
|---|---|
| Local PG17.11 replay of 000–059 from empty (scratch DB, stubs) | 60 of 60 applied |
| `check_schema_contract.mjs` on the replay | 29 of 30 pass; parity fails on function body hashes |
| Repeat of the replay through the committed script `supabase/verification/rehearsal/run-pg17-rehearsal.ps1` | Same result (60 of 60; 29 of 30) |
| Prefix-mounted browser suite (`/hub`, Chromium and WebKit iPhone 13 profile) | 18 passed, 2 skipped at `ea29630` (not rerun at HEAD) |
| TypeScript typecheck and devotional tests | Passed at `ea29630` |
| Hosted Production or Preview migrations | None applied |

Outstanding failures or gaps:
- Function-body hash parity (79 of 84 functions), unexplained.
- Seven inherited BSC certification failures are a documented baseline defect, not a regression. They are not fixed by
  this work.
- Desktop WebKit service-worker stall is an **open release blocker** (see `docs/production-readiness.md` section 0a).
- PostgreSQL 17 hosted-stack certification (`supabase db reset --local` with Docker-based Supabase) has not been run.
  The local rehearsal above uses stubs and is not final certification.

## 6. Outstanding blockers, in dependency order

1. **Function-body hash parity.** Determine whether the golden was generated in a different environment or whether a
   function body genuinely differs. Method: regenerate the golden with a real `supabase db reset --local` in a cloud
   environment where Docker is available, or compare each differing function's `pg_get_functiondef` text with its
   source migration. Do not overwrite the golden to make the check pass.
2. **Lineage reconciliation (059–110).** The audience, communication, assignments and identity objects exist only on the
   cert lineage. Decide, with owner approval, which migration files are carried forward and how they are renumbered
   after 059. History 000–059 is not renumbered or edited.
3. **Preview-only DDL source.** Full definitions, including function bodies, must come from the cert lineage or
   another authoritative source. The hosted evidence has only `body_md5`.
4. **Production drift.** Production lacks 12 website tables from the golden, lacks the five-state attendance check and
   the active-profile self-edit policy, and lacks the 22 Preview-only tables. The cause of drift behind matching
   ledger hashes is not explained.
5. **Edge Function port.** Port `trustedClientAddress` into the hosted lineage (not started).
6. **Attendance ambiguous-record report.** Flag rows that cannot satisfy the five-state check. Preserve values. Block the
   migration if constraint validation cannot pass.
7. **Identity duplicate report.** Detect and report only. No merges.
8. **Desktop WebKit service-worker stall.** Open release blocker, not approved for release until resolved or
   explicitly dispositioned.

## 7. Evidence files and secure access (not committed)

These files stay outside the repository. Do not copy them into the repository, pastebins, issues or chat.

- `blwyork-preview-evidence.json` and `blwyork-production-evidence.json`: consolidated read-only evidence from the
  single-query script. Originally in `C:\Users\moser\Downloads\`. Provide them to the cloud environment through its own
  secure file mechanism, not through git.
- Read-only evidence scripts (safe to commit, no data): `preview_readonly_evidence.sql` and
  `preview_evidence_single.sql` in the originating scratchpad. The repository's own equivalent is
  `supabase/verification/schema_fingerprint.sql`.
- Diagnostic preserved copies (not authoritative, not application code): in the scratchpad folder
  `diag-final-20261126-232908`, with `SHA256SUMS.txt`. Do not commit them.

Access rules:
- Hosted Preview project reference: `yziuhtxtznginhdpqurb`. Hosted Production: `rjtstjmtddqhesexltbj`. Verify the project
  reference before any read, and never use a Production reference for test accounts.
- Database connection strings, anon keys, service keys and test-account passwords come from the cloud environment's
  secret store. Never write them to files in the repository or print them.
- Preview test accounts are synthetic, created only in the Preview project, and removed after use.

## 8. Environment setup for a cloud coding agent

Prerequisites: Node.js 22 (the local run used 22.12.0), Git, PostgreSQL 17 client and server (the local run used
17.11). Docker is not required for the local rehearsal, but is required for the hosted-stack certification.

```powershell
git clone <repository> BLW-York-Hub
cd BLW-York-Hub
git checkout remediation/blw-york-wave1-5
npm ci
npm --prefix site ci
```

Do **not** run `npm install` inside `site/` without a lockfile check. An earlier `npm --prefix site install` added a
self-referencing dependency (`blw-york-portal: file:..`) that had to be reverted.

Local rehearsal (scratch database, outside the repository):

```powershell
.\supabase\verification\rehearsal\run-pg17-rehearsal.ps1 -PgBin "C:\Program Files\PostgreSQL\17\bin" -Port 54317 -Scratch "<an absolute folder outside the repo>"
```

Expected: `applied=60 of 60`, then 29 of 30 checks pass with the parity failure described in section 4.

Application checks:

```powershell
npx tsc --noEmit
npm test -- --watchAll=false
npm run build
npx playwright test -c playwright.prefix.config.ts
```

## 9. Exact next actions

1. Verify HEAD equals the commit this document records, and that `git status` is clean.
2. Resolve blocker 1 (function-body hash parity) with a real PostgreSQL 17 Supabase replay in the cloud environment,
   without editing the golden to force a pass.
3. Produce a lineage map between `origin/cert/website-d2-50f8aaa` (059–110) and the unified 000–059 sequence. Report it
   for owner approval before writing any migration.
4. After approval, write forward-only reconciliation migrations numbered after the existing sequence. Each migration
   gets a rollback-free replay test and a positive and negative authorization test.
5. Run the three-path certification (fresh install, Preview-shaped upgrade, Production-shaped upgrade) and report actual
   results.
6. Keep PR #97 and PR #98 independent. Do not merge. Do not deploy.

No step in this list authorises a hosted migration, a ledger change, a reset, or a Production action.
