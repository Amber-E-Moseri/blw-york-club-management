# Audience reconciliation: certification report

Companion to `docs/audience-shared-contract.md`. Every number here comes from a run on the integration branch.

## 1. Environment (and what was not run)

| Item | Result |
|---|---|
| Database | **PGlite 0.5.9** (Postgres compiled to WebAssembly), in-process. Real RLS, `SECURITY DEFINER`, `SET ROLE`, triggers and constraints. |
| Supabase objects | Minimal shim for `auth` (`uid`, `role`, `jwt`, `users`) and `storage` (`filename`, `foldername`, `buckets`, `objects`), plus roles `anon`, `authenticated`, `service_role`, `supabase_admin`. The harness is `supabase/verification/pglite_replay.mjs`. |
| Extensions | Not available in PGlite. `create extension` lines are skipped. `gen_random_uuid()` is core Postgres. |
| Docker / hosted | **Not used.** Free RAM was about 0.6 GB out of 15 GB, and six Supabase stacks belonging to other agents were running (`supabase_db_opscert`, `supabase_db_blwcanon`, `supabase_db_BLW_York`, `supabase_db_clickup`, and others). Nothing was started, stopped or changed. |
| Real-browser E2E | **Not run.** No UI was driven against a running app. |
| Schema golden | **Not regenerated** (§6). |

What PGlite can and cannot show: it proves the SQL and policy logic against Postgres semantics. It does not prove PostgREST routing, Supabase's own role grants, pg_cron, or Edge Function runtime behaviour. Those need a real stack.

## 2. Replay

`openReplay()` applies every file in `supabase/migrations` in name order and stops at the first failure.

| Run | Result |
|---|---|
| Baseline chain 000–067 (before this work) | 68 files, 0 failures, after adding the Supabase shim for `auth.jwt`, `supabase_admin` and `storage.filename` |
| Merged tree, with 068 and 069 | **71 files applied** (000–069 plus the duplicate `066`), 0 failures |
| Fingerprint query on the baseline chain | Runs and returns a document: 62 public tables before 069. Not used as golden (§6). |

## 3. Security probes: before and after

The baseline probes ran against migrations 000–067 as the real roles. Each row is what a caller could do before this work and after it.

| # | Probe | Before | After |
|---|---|---|---|
| P1 | Member calls `resolve_audience(all)` | 1 row, the caller's own (066 already closed enumeration) | 1 row (unchanged) |
| P2 | Member calls `resolve_audience_all` | denied (permission denied) | denied |
| P3 | Pending member calls `resolve_audience` | 0 rows | 0 rows |
| P4 | Member reads `saved_group_members` | 0 rows (066) | 0 rows |
| P5 | Leader posts to a spec of two cells | denied, **but only because leaders cannot read `audience_specs`**. The cell check never ran. | denied by the caller-scope check |
| P6 | Leader posts a broadcast (NULL spec) | **allowed** | **denied** (42501) |
| P7 | Spec deleted while an affirmation references it. The affirmation then reads as broadcast. | **NULL, cell-B member sees it (1 row)** | **deletion refused**; `RESTRICT` plus immutable trigger |
| P8 | Member added to group after an announcement was published | **0 → 1** (sees it) | **0** (snapshot) |
| P9 | Multi-cell spec announcement, cell-B member | 0 rows | 0 rows |
| P10 | Client updates or deletes a spec | denied (no grant) | denied, and the trigger also refuses it for the owner |
| P11 | Non-recipient reads a targeted event | **1 row** (every authenticated user) | **0 rows** |
| P12 | `can_see_affirmation` for a non-recipient, after P7 | **true** | **false** |
| N1 | Notification for an event with `audience = 'cells'` | **sent to every active member** (`notify-event` fallback, code path) | **refused**; routed by `_shared/audience-recipients.ts`, 15 unit tests |

Probes P1–P4, P9 and P10 were already closed by migration 066 or the grant model. They are kept so the picture is complete.

## 4. Real-session certification (66 of 66)

`supabase/verification/audience_reconcile_certification.mjs` creates fixtures inside a fresh database and runs each check as the role a client would use.

| Area | Checks | Result |
|---|---|---|
| Enumeration | caller-scope resolve; `resolve_audience_all` denied; anon denied; pending resolves to nothing; member cannot read specs, saved-group memberships or insert specs; RPC refused for a member; member cannot delete a group | 10 pass |
| Audience types | all, cells, saved groups, explicit (pending dropped), composite, mode/kind mismatch refused, archived group refused, leader of an empty cell refused, leader can create own-cell spec, cells resolve | 10 pass |
| Deduplication | overlapping cell, group and person reach each person once | 1 pass |
| Exclusion | exclusion spec accepted; excluded cell and person removed from everyone | 2 pass |
| Cross-cell | leader cannot target another cell, a group, a composite, exclusions, everyone, or two cells | 6 pass |
| Publication (announcements, events) | leader publishes to own cell; leader cannot post broadcast or cross-cell; admin broadcast; targeted event; legacy broadcast event; event refused when its audience emptied | 7 pass |
| Affirmations and events | targeted affirmation to a group; non-recipient cannot declare; recipient can declare; targeted event | 4 pass |
| Isolation | recipients see targeted content; non-recipients and pending members do not (announcements, affirmations, events) | 7 pass |
| Membership changes | late joiner cannot see; leaver keeps access; moved member keeps old-cell access; new-cell member cannot see it; rejected loses access | 6 pass |
| Immutability | published audience cannot change or become NULL; events audience cannot change; spec cannot be updated or deleted; archived group keeps snapshot and cannot seed new content | 8 pass |
| Notify | service role reads frozen recipients; authenticated cannot | 2 pass |
| Messaging (067) | admin message to one person reaches exactly that person; leader cannot send to another cell | 3 pass |
| **Total** | | **66 pass, 0 fail** |

Every check is recorded with its SQLSTATE or the observed row count, so a failure states what happened.

## 5. Other test results

| Suite | Result |
|---|---|
| `audienceResolution.test.ts` (resolver, spec conversions, RPC args) | **32 / 32** |
| `audienceRouting.test.ts` (notify routing, fail-closed) | **15 / 15** |
| `operationalWorkstreams.test.ts`, `messagingMigration.test.ts`, `messagingRules.test.ts`, `MessageComposer.test.tsx` | pass |
| Full Jest suite | **449 passed, 2 failed, 11 skipped** (462 total). The 2 failures are the migration-prefix guard, §7 blocker 1. |
| `tsc --noEmit` | **2 errors**, both in `operationalWorkstreams.test.ts` (`matchAll` iteration under the ES5 target). Present on the ops branch before this work. |

## 6. Schema golden: not updated

`supabase/verification/schema_fingerprint.golden.json` holds 54 tables, which is the schema **before** migration 059. It does not include `saved_groups`, `audience_specs`, `assignments` or any `communication_*` table already on the operational branch. The golden was already stale before this change, so regenerating it from PGlite would not be production parity.

Regeneration needs a replay on a production-parity Supabase stack. The PGlite fingerprint is also not used for that, because of the shim (§1).

## 7. Blockers

1. **Duplicate migration prefix `066`.** `066_audience_resolution_scope.sql` (Agent 3) and `066_meeting_invitee_read_fix.sql` (ops `9118787`). `migrationArchitecture.test.ts` fails on it. Agent 6 renumbers one. The replay is order-independent, so this is a naming fix. It is not decided here.
2. **`065` edited in place** (`acdac39`, ops). Not forward-only. A fresh replay is correct, but any database that applied the earlier `065` will not match. The fix belongs in a new forward migration.
3. **Messaging certification (Agent 3) cannot run as committed.** `cert_pass` and `cert_fail` are not `SECURITY DEFINER`, so recording a result as `authenticated` is denied. The meeting certification fixed the same defect. With that one change in a scratch copy, **17 of 18** checks pass. The eighteenth checks the wrong thing: `member_b1` is a recipient of the message it inspects (`send_message(... array[member_a1, member_b1, member_a1] ...)`), so seeing their own row is correct. Correcting the assertion to "sees exactly one row, and not `member_a1`'s" is the fix.
4. **Schema golden stale** (§6). Needs a production-parity replay.
5. **`tsc` errors in `operationalWorkstreams.test.ts`** (pre-existing on ops). Trivial fix (`Array.from`), but it is another owner's test file, so it is not changed here.
6. **Real-browser E2E not run.** Needs a running app against a real stack.
7. **Unresolved product decision:** `meeting`-audience events and broadcast events stay visible to all active members, as before. Targeted events are now restricted.

## 8. Reproduce

```bash
# Install PGlite once, outside the repo:
mkdir -p ~/pglite-replay && cd ~/pglite-replay && npm init -y && npm i @electric-sql/pglite@0.5.9

# From the repo root:
PGLITE_MODULE="file:///<absolute path to ~/pglite-replay>/node_modules/@electric-sql/pglite/dist/index.js" \
  node supabase/verification/audience_reconcile_certification.mjs

npx react-scripts test --watchAll=false --testPathPattern="audience"
```

Exit code 0 means every certification check passed. Non-zero prints each failing check with its evidence.
