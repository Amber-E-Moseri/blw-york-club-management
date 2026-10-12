# Round 4: prayer visibility (T7), cross-cell isolation, and release hardening

Branch `remed/blwyork-authz-045`, based on `ebfc27b`. Migrations `045` and `046` are unchanged. One new forward-only migration, `047`, is added.

## 1. Inspection of the effective prayer policies and app queries

Effective `prayer_requests` policies at `ebfc27b`:

| Policy | Command | Effective rule |
|---|---|---|
| `prayers_own` | ALL | `author_id = auth.uid()` and caller active |
| `prayers_shared_read` | SELECT | `visibility = 'shared'` and caller active. **No check on the author.** |
| `prayers_leadership_read` | SELECT | `visibility in ('leadership','shared')` and author active and current role in (coordinator, admin, cell_leader). **No cell scope.** |
| `prayers_coordinator_manage` | UPDATE | active admin or coordinator (`is_admin_or_coordinator`) |

App queries (`src/lib/queries.ts` line 148 and the testimony and admin pages): `select('*')` with `is_active = true`, with no client-side visibility rule. Row-level security is the only control on who sees which prayer.

## 2. Reproduction with real authenticated sessions

`supabase/verification/prayer_visibility_session_test.mjs` runs through the same path as the app. It creates accounts through the local auth service, signs in to get JWTs, and calls PostgREST with each bearer token. Authors post while active, then one author is deactivated. Every viewer reads with their own token.

Result at `ebfc27b`: **13/19 passed, 6 failed.** The six failures are real exposures:

| Viewer | Leaked row | Cause |
|---|---|---|
| ordinary member A and B | shared prayer of a **deactivated** author | `prayers_shared_read` has no author check (T7) |
| cell leader A | leadership prayer of cell B's member | leadership read has no cell scope (isolation) |
| cell leader A | shared prayer of a deactivated author | T7 |
| cell leader B | leadership prayer of cell A's member | isolation |
| cell leader B | shared prayer of a deactivated author | T7 |
| coordinator and admin | shared prayer of a deactivated author | T7 |

The deactivated author's own view was already empty (F5).

## 3. The fix: migration 047 (forward-only)

Two SELECT policies on `prayer_requests` are replaced. Nothing else changes.

```sql
drop policy if exists prayers_shared_read on public.prayer_requests;
create policy prayers_shared_read on public.prayer_requests for select
  using (
    visibility = 'shared'
    and public.is_active_member()
    and public.is_active_profile(prayer_requests.author_id)
  );

drop policy if exists prayers_leadership_read on public.prayer_requests;
create policy prayers_leadership_read on public.prayer_requests for select
  using (
    visibility in ('leadership', 'shared')
    and public.is_active_profile(prayer_requests.author_id)
    and (
      public.is_admin_or_coordinator()
      or public.is_cell_leader_for_profile(prayer_requests.author_id)
    )
  );
```

Why this is the narrowest change:
- The author check reuses `is_active_profile` (security definer, so it works regardless of the caller's `profiles` visibility).
- Cell scope reuses `is_cell_leader_for_profile`, which requires the leader to be an active cell leader in the **same cell** as the author.
- Coordinators and admins keep cross-cell access, as approved.
- Ordinary members keep shared prayers of active authors, as approved.
- Ownership (`prayers_own`), moderation (`prayers_coordinator_manage`) and private prayers are unchanged.

## 4. Test coverage added

**Real sessions** (`prayer_visibility_session_test.mjs`): **19/19** after 047, up from 13/19. It covers active, pending (cannot post), rejected (cannot post) and inactive (posted while active, then deactivated) authors. Viewers are ordinary members in two cells, a cell leader in each cell, a coordinator and an admin.

**Real-schema matrix** (`authz_status_matrix_test.sql`, section H, 15 new checks, added after the existing sections so the earlier expectations are unchanged): **83/83**. It covers the following.
- Ordinary members see only active authors' shared prayers (H1, H2).
- Cell leader C1 sees own-cell leadership and active shared, but not cross-cell (H3). Cell leader C2 sees no leadership prayers from other cells (H4, H5).
- Active coordinator and admin see active authors' leadership and shared prayers across cells (H6, H7). Inactive coordinator sees nothing (H8).
- Authors read their own prayers only while active (H9, H10, H11).
- Moderation: an active coordinator can moderate a readable prayer (H12). A cell leader and a member cannot (H13, H14). A coordinator **cannot** moderate an inactive author's prayer (H15), see decision D2.

## 5. Permission decisions and tradeoffs

- **D1 (behaviour change, cross-cell).** Cell leaders no longer see leadership prayers from other cells. This implements the requirement to preserve cross-cell isolation. The earlier policy had no cell scope. Confirm that cell leaders should be limited to their own cell's leadership prayers.
- **D2 (moderation gap).** A coordinator cannot moderate an inactive or rejected author's prayers. Staff can only update rows they can read, and the leadership feed excludes non-active authors (approved T7). Options: (a) leave as is; (b) add a narrow moderation-only SELECT for staff on inactive-author prayers, which re-exposes that content to staff; (c) an administrative cleanup path run by a person. Recommended: (a) unless a moderation case requires otherwise.
- **D3 (shared feed).** Shared prayers are visible to all active members, as before. Only the author's status now affects visibility. That matches the approved T7 wording.
- **BSC isolation.** Prayers are not scoped to BSCs in the schema, so BSC scope does not apply to prayer visibility. Cell scope is the only group boundary applied here.

## 6. Results

| Gate | Result |
|---|---|
| Replay `000`–`047` from empty (two runs) | PASS, 48 migrations; second replay **byte-identical** fingerprint |
| Real-session prayer visibility | **19/19** (was 13/19 before 047) |
| Real-schema authorisation matrix (with section H) | **83/83** (68 previous + 15 new) |
| Real-schema BSC effective test | 37/37 |
| Foundation School onboarding | 35/35 |
| Confession app compatibility | 10/10 |
| SQL: release RLS and people | 33/33 |
| SQL: guard and approval bootstrap | 32/32 |
| SQL: active guard (cert 031/032) | 11/11 |
| SQL: meeting attendance | 9/9 |
| Schema contract checks (repository golden excluded) | 29/29 |
| Proposed golden (047) parity | 30/30 (not written to the repository) |
| Notify-event (transpiled) | 45/45 |
| Edge security / P0 behavioural / P0 boundary | 18 / 123 / 44 |
| Auth workflow / authorisation / email and push / storage | 12 / 61 / 36 / 30 |
| Jest | 279 passed, 1 failed (golden gate), 11 skipped, 291 total. Suites: 33 passed, 1 failed, 1 skipped, 35 total. |
| TypeScript (`npm run typecheck`) | PASS, exit 0 |
| Production build | PASS, compiled successfully, 0 warnings |
| Playwright | **11/11** |

Not run: the Deno-runtime notification test (Docker host networking, unchanged from round 1), and anything hosted.

**Changed permission expectations in this round: none.** Existing expectations are unchanged. The new checks (section H, and the session test) are additive.

Earlier round changes still stand: BSC A1, A2 and B1 (active members only); cert 032 (pending cannot read own declaration, T1); matrix E1 (coordinator enrolments 2, T6).

## 7. Files changed in this round

| Status | File |
|---|---|
| new | `supabase/migrations/047_prayer_visibility_active_author_and_cell_scope.sql` |
| new | `supabase/verification/prayer_visibility_session_test.mjs` |
| modified | `supabase/verification/authz_status_matrix_test.sql` (section H added, 15 checks) |
| removed | `docs/release-remediation/proposed_schema_fingerprint_046.golden.json` (superseded) |
| new | `docs/release-remediation/proposed_schema_fingerprint_047.golden.json` (not written to the repository golden) |
| new | `docs/release-remediation/ROUND4_REPORT.md`, `r4_*.txt` run logs |

No earlier migration file changed. `src/` is unchanged. The repository golden is unchanged.

## 8. GO/NO-GO

**Release review (combined candidate 045 + 046 + 047): GO.** Every decision is implemented, each change is forward-only, and the test totals above pass.

**Production: NO-GO** until these are resolved:

1. **Golden.** Approve `docs/release-remediation/proposed_schema_fingerprint_047.golden.json` and write it into `supabase/verification/`. Until then the Jest schema-contract gate fails (1 failing test).
2. **Hosted history.** Run the read-only checks in `docs/release-reconciliation/hosted_readonly_checks.md` and `supabase/verification/check_migration_history.mjs` against the production project. Hosted application of 045, 046 and 047 needs its own approval.
3. **Deno-runtime notification run** (`NOTIFY_MODE=deno`), on a machine where Docker host networking works, or in CI.
4. **Hosted test project and a real-device smoke test** of notifications.
5. **Decisions D1 and D2** (section 5). D1 changes cell-leader access. D2 is a moderation gap.
6. **Browser coverage.** The confession, BSC, prayer, habit and Foundation School pages have database and session coverage but no browser tests.
7. **Stand-in suite.** `bsc_access_model_test.sql` still tests stand-in helpers. It should be rewritten to use the real helpers, or removed in favour of the real-schema suites.

## 9. Remaining steps to finalise the combined release candidate

1. Review and decide D1 and D2.
2. Commit this round (`047`, the session test, section H, the round-4 report and logs) on `remed/blwyork-authz-045`.
3. Approve the golden and write it into `supabase/verification/`. Re-run the Jest schema-contract test and the contract checker.
4. Rebase or merge `remed/blwyork-authz-045` onto `rc/blwyork-combined-release` (the authorisation work is new on top of the round-2 release candidate). Re-run the full gate set on the merged tree.
5. Run the hosted read-only checks, decide the hosted case (A, B or C from round 2), and get approval for any hosted migration. Do not apply anything before that approval.
6. Run the Deno-runtime notification test in CI, and complete the hosted test-project smoke test.
7. Add browser tests for the affected pages, then re-run the browser suite.
8. Re-assess GO/NO-GO for production.
