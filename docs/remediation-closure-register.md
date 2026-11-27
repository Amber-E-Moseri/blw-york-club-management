# Remediation closure register: Waves 1–5

## Approved continuation and development certification (2026-11-26)

Directive baseline: `43993e6`. Implementation commit: `bfb1fd0` (`fix(remediation): reconcile membership attendance and certification`).
This section supersedes the open owner decisions and development blockers recorded later in this historical register.
Production remains on HOLD: no hosted database was queried or changed, no migration was applied outside isolated replay,
no deployment was made, and nothing was merged to `main`.

### Implemented resolution

- Account registration/approval and organizational membership are now explicit separate authorities. `profiles` remains
  authoritative for Hub identity, approval, role/access and account cell assignment. `people` plus `memberships` is the
  organizational-membership authority.
- New profile rows that omit status default to `pending`; migration 019's signup trigger already writes `pending`
  explicitly. No existing profile was bulk-updated, so active, pending, rejected and inactive records retain their state.
- `organizational_member_directory` reports active organizational memberships and reports linked Hub approval separately.
  Existing operational account-derived rosters are not abruptly replaced; the UI labels them as approved Hub accounts.
- `membership_reconciliation_review` preserves and flags unlinked accounts, active membership/account-approval conflicts,
  role differences and cell differences for administrators. It performs no merge, deletion, activation or reassignment.
- Active and pending users may update only their own ordinary profile fields. The migration 028 policy/guard mismatch is
  corrected. The existing trigger still protects email, role, status, cell, admin role, joined date and person link; the
  application now treats a zero-row profile update as a failed save.
- Attendance status is authoritative with `invited`, `confirmed`, `attended`, `absent`, and `excused`. The legacy
  `attended` boolean is trigger-derived for old readers. Historical `attended=false` is migrated to `confirmed`, not
  inferred as an absence. Members respond through the scoped RPC and cannot certify their own outcome; authorized meeting
  organizers record outcomes for other people. Zero-row attendance writes are application failures, not silent success.
- Remaining calendar-date uses in habits, contact and meeting forms, confessions, books and email preview templates use
  `America/Toronto` day keys and calendar arithmetic. True timestamps remain UTC instants.
- Communications now labels provider-accepted sends, verified failures, recorded opens, and recorded clicks separately.
  It states that delivery status is unavailable and absence of a tracking event does not prove non-delivery or non-open.
  No provider, real send, scheduled delivery, or twice-weekly automation was added.

### Migration inventory, compatibility and rollback

| Migration | Change | Grants, RLS and execution | Compatibility / rollback |
|---|---|---|---|
| `045_account_membership_profile_reconciliation.sql` | Pending profile default; active self-edit policy; approval-aware people/membership policies; organizational-member and reconciliation views | Views revoke `public`/`anon`, grant read to `authenticated`/`service_role`, use `security_invoker`; reconciliation rows additionally require admin/coordinator; underlying tables keep RLS | No row rewrite. Roll back only by a new forward migration restoring the prior default/policies and dropping the two views. Records are unaffected. |
| `046_attendance_status_authority.sql` | Adds `meetings.published_at`, authoritative `attendance_status`, compatibility trigger and response RPC; replaces insert/update attendance policies | Trigger has no API execute grant; RPC revokes `public`/`anon` and grants `authenticated`/`service_role`; RLS permits self confirmation/excusal and manager outcomes for other users | Existing uniqueness and rows are preserved. Do not drop the status column after new states exist; a rollback requires backup plus a forward compatibility migration that maps outcomes deliberately. |

Integration migration 074 was used only as a behavioral reference. Its audience/publication dependency chain was not
transplanted. Historical migrations 000–044 were not renumbered or rewritten.

### Reviewed schema-contract changes

The previous seven CI failures are resolved: the BSC assertion and six contract/golden discrepancies. Contract additions
are evidence-backed by the fresh replay:

- `bscs` and its three functions/triggers (`040`, `044`) and `contacts_bsc_view` (`042`) existed in the accepted schema but
  were absent from the reviewed inventory. Their exact table privileges, function grants, policies and search paths are
  now asserted.
- The two migration 045 views and migration 046 trigger/RPC are allow-listed with exact security modes and execution grants.
- Service-role `SELECT`-only access for `bscs` is represented explicitly instead of being incorrectly compared with the
  default CRUD expectation.
- Platform default ACLs remain independently checked for leaks; whole-fingerprint parity ignores the bootstrap-specific
  default-ACL section because PGlite and Supabase provision it differently.
- The golden fingerprint was generated only after the full replay, 19 authorization controls, nine attendance controls,
  seven membership/profile controls, and a second independent replay passed.

### Final verification evidence

| Check | Result |
|---|---|
| TypeScript (`npm run typecheck`) | PASS, exit 0 |
| Complete Jest suite | PASS: 52 suites passed, 1 skipped; 520 passed, 11 skipped; 0 failed |
| Seed/script safety (`npm run test:scripts`) | PASS: 11/11 |
| Full migration replay (`000`–`046`, PGlite, twice independently) | PASS: 47 migrations each; byte-identical fingerprints |
| Database authorization regression | PASS: 19/19 |
| Attendance read/write authorization and compatibility | PASS: 9/9 |
| Membership reconciliation and profile authorization | PASS: 7/7 |
| Schema contract + golden fingerprint | PASS: 31/31 |
| Main production build | PASS |
| Public-site Vitest | PASS: 190/190 |
| Public-site production build | PASS |
| Mocked Chromium desktop/tablet/mobile regression | PASS: 45/45 (desktop, 768, 390, 375; light/dark; all roles) |

PGlite limitations remain explicit: it uses Supabase auth/storage shims and does not replace a hosted or containerized
Supabase/PostgREST/GoTrue certification. No Docker was run locally.

### Eleven skipped Jest tests

All 11 skips are the tests in `quickAddRealCode.integration.test.ts`. They are intentionally gated on local-only
`CERT_SUPABASE_URL`, anon key and service-role key, create throwaway real Auth accounts, exercise PostgREST concurrency and
clean up afterward. With no local Supabase service and Docker prohibited, skipping is legitimate and is not a hidden
application failure. It does represent one unavailable real-session release-coverage bundle; PGlite and ordinary Jest
cover the underlying migration, identity, authorization and query rules, but not real GoTrue/PostgREST concurrency.
The existing CI/local-Supabase job should run these 11 tests before production deployment.

### Remaining issues and release decisions

- No unresolved independent development repair is known from the approved directive.
- Dependency audit output still reports inherited package vulnerabilities (root: 54; public site: 3); no forced or
  breaking dependency upgrade was authorized in this remediation.
- React test output contains existing `act()`/deprecation warnings; assertions pass and no tests were suppressed.
- The real local-Supabase release smoke and 11 real-session integration tests require the existing CI/local stack.

**Development release-candidate: GO.** The implementation, isolated database replay, contract certification, builds,
unit/integration tests and available browser regressions pass.

**Production deployment: NO-GO / HOLD.** Production-only blockers are: identify and verify the correct BLW York hosted
database and deployment; take a production backup and run a read-only fingerprint comparison; execute migrations 045–046
first on an isolated production clone/staging environment; run the existing real Supabase/GoTrue/PostgREST and release
smoke jobs; review the reconciliation queue with authorized operators; approve the deployment and rollback window. No
production write, migration, deployment or merge is authorized by this certification.

Branch: `remediation/blw-york-wave1-5`. Base: `main` at `9e57c54`. Production: HOLD (no production writes, no migrations
applied, no deployments, no merge into `main`, no PR merged or closed).

## P0: production sign-in failure on iPhone Safari (2026-11-26)

Report: submitting the login form on `https://blwyork.vercel.app` in iPhone Safari produced
`FetchEvent.respondWith received an error: Returned response is null.` The login card also had a nearly invisible
"Sign In" heading, inconsistent light and dark colours, poor autofill styling, and a card touching the screen edges.

**Finding.** `public/service-worker.js` (the worker `src/index.tsx` registers at `/service-worker.js`) answered every
request for a `*.supabase.co` host with `fetch(request).catch(() => caches.match(request))`. The password POST to
`/auth/v1/token` went through that handler. When the network request failed, `caches.match` resolved to `undefined`, and
respondWith received no Response. The same handler also covered non-GET requests and HTML navigations.

**Confirmed root cause (by code and by test).** The null response is the `caches.match` fallback. It is not a
Supabase error. The exact condition that made the Supabase fetch fail on the iPhone was not reproduced, because no device
or WebKit engine was available here. The fix does not depend on that condition: the worker no longer intercepts those
requests.

**Other causes, found in the same review.**
- Dark theme: the app sets `.dark` on `<html>`. The global `h2` rule then applies `dark:text-slate-100` to a white card,
  so the heading was nearly invisible. The field labels had no dark variant either.
- Browser autofill painted a pale background with dark text, and no rule covered it.
- Raw exception text reached the UI: `Load failed` and `Failed to fetch` from the auth client, and the raw `Profile not
  found` and profile-load messages.
- A second tap on Sign In sent a second password request, because the form did not block re-submission.

**Implementation.** Commit `b8c0232` on this branch, followed by the `7a37752` dependency commit. The fix is in:
- `public/service-worker.js`: intercepts only same-origin GET requests for hashed `/static/` bundles (cache-first). Auth,
  token refresh, every Supabase host, `/api/`, non-GET methods, navigations and any request with an `Authorization` header
  pass through. A failed static fetch resolves to `Response.error()`. Caches are versioned (`blw-york-v2`), nothing is
  precached, and activate deletes every other cache, including `blw-york-v1` and `cc-portal-v1`.
- `public/sw.js`: replaced with a retirement worker with no fetch handler. It deletes caches and unregisters itself, so a
  device that installed the old `/sw.js` registration drops it on the next update check.
- `src/lib/serviceWorker/pushServiceWorker.ts`: removes any registration running `/sw.js`, then registers
  `/service-worker.js`. Registration failures are logged, not thrown.
- `src/lib/auth.ts`, `src/hooks/useAuth.ts`: network failures map to a plain message. The raw text stays in `AuthError.code`
  and is not shown. Existing auth messages that `authFailClosed.test.ts` asserts on are unchanged. The fail-closed
  behaviour for pending, inactive and unrecognised accounts is unchanged.
- `src/pages/Login.tsx`, `src/components/foundation/Input.tsx`, `src/styles/globals.css`: explicit light and dark colours for
  the card, heading, labels and error text. Autofill is pinned per theme. Safe-area padding gives the card margins on
  phones. A second submit is blocked while a sign-in is in flight.

No authorization or RLS change, no migration, no secret, and no deployment.

**Verification (run on the committed content, `b8c0232`, in an isolated copy with its own `node_modules`).**

| Check | Result |
|---|---|
| Regression test against the pre-fix worker (`516ef7b`), `serviceWorkerAuthRegression.test.ts` | 9 of 11 cases fail. Red as required. |
| `serviceWorkerAuthRegression`, `pushServiceWorkerRegistration`, `legacyServiceWorkerKillSwitch` | 18 / 18 pass |
| Full Jest (`CI=true react-scripts test`) | 55 suites passed, 1 skipped; 538 tests passed, 11 skipped |
| `tsc --noEmit` | Exit 0 |
| Playwright Chromium, `login-regression.spec.ts` and `auth.spec.ts` | 10 / 10 pass (dev server, mocked Supabase) |
| Playwright Chromium, `login-regression.spec.ts` against the pre-fix `Login.tsx` (`516ef7b`) | 3 fail: the card and heading contrast checks and the card-inset check. The contrast check cannot find the `.login-card` marker in the old markup, so it does not measure the old colours. |
| Playwright WebKit (iPhone 13 project, `webkit-iphone`) | **Configured, not run.** The WebKit browser is not installed in this environment. |
| Real iPhone Safari | **Not tested.** Needs a manual check. |

Notes on the verification:
- Playwright on port 3100 reached another process, not this checkout, so those runs were discarded. The results above
  come from a dedicated dev server on port 3300.
- The service-worker regression test exercises the worker file itself, under fake ServiceWorker globals. It does not
  exercise the browser's own service-worker handling, so it does not reproduce the iOS engine's behaviour.

**Is a standalone production hotfix advisable?** Yes, once the owner approves a deployment. The defect is on `main`:
`public/service-worker.js` there is the same handler, so every current production visitor who has that worker is exposed.
The change is narrow (service worker, auth messages, login UI). It has no schema, RLS or deployment dependency. Recommended
route: cut a hotfix branch from `main`, cherry-pick `b8c0232` (and `7a37752` only if its dependency changes are needed),
re-run the Jest and Playwright checks on that branch, then deploy after approval. A visiting device that still runs the
old worker takes the new one on its next update check, and the new `public/sw.js` removes the legacy registration.

**Open items.**
1. Run the Playwright `webkit-iphone` project on a machine with WebKit installed, and check sign-in on a real iPhone.
2. Confirm the production deployment serves the new `service-worker.js` (cache headers on `/service-worker.js` and
   `/sw.js`), so the update check reaches the device.
3. Owner review of the dev-only audit result in `7a37752` (22 high findings remain, all in the dev toolchain).

## Commits

| SHA | Wave | Subject |
|---|---|---|
| `7d7dc34` | 1 | fix(security): add in-body authorization guard to get_ror_streak (port PR #78) |
| `93c9818` | 1 | fix(security): restrict BSC reads and helper access to active accounts (port PR #86) |
| `f6c0657` | 1 | test(security): PGlite authorization regression tests for ROR streak and BSC access |
| `4863346` | 1 | fix(auth): fail closed on missing or unknown status and role (port PR #87, targeted) |
| `b72b1bd` | 1 | fix(security): fail closed for test-account creation (create-test-users.js) |
| `5216b89` | 1 | fix(security): refuse the BLW York production project in certification harnesses |
| `23b6848` | 2 | fix(dashboard): America/Toronto reporting calendar, current-month and upcoming counts (port PR #96, targeted) |
| `0675e3d` | 2 | fix(meetings): correct month headings and Toronto 'today' labels |
| `cd1b60e` | 3 | fix(membership): count and list approved accounts only |
| `a6af0a6` | 4 | fix(comms,ror,devotionals): reporting correctness and relay token check |
| `fe7fcfc` | 5 | fix(meetings): report attendance as unavailable, add attendance schema evidence |

Branch diff against `main`: 54 files changed, 3267 insertions, 184 deletions.

## Verification (final run, at `fe7fcfc`)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass (exit 0) |
| Jest, full (`CI=true react-scripts test`) | 51 suites passed, 1 skipped; 506 tests passed, 11 skipped |
| PGlite authz replay, full chain 000..044 (`remediation_wave1_authz_pglite.mjs`) | 19 / 19 |
| PGlite attendance evidence, main chain (`attendance_schema_pglite.mjs`) | 6 / 6 |
| `npm run test:scripts` (seed guard) | 11 / 11 |

Note: the pre-fix control is the same replay stopped at 042, before the Wave 1 migrations. In the earlier session it passed 6 of
14 checks and failed 8, which shows the checks detect the defects. Waves 3–5 added checks, and that control was not re-run
after they were added.

## Findings

Status key: **Resolved** = implemented and verified by a test that runs here. **Partly** = implemented, with a remaining
gap noted. **Open** = not changed, needs an owner decision or access this environment does not have.

### Wave 1: security and certification

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1.1 | `get_ror_streak` returned any member's streak to any authenticated caller | Resolved | `7d7dc34` (migration 043); authz replay: stranger, out-of-cell leader, pending and inactive callers get 0 rows |
| 1.2 | `bscs_read` allowed any authenticated (including pending) account to read BSC rows; helpers not gated | Resolved | `93c9818` (migration 044); authz replay: pending and rejected read 0 rows; helper denies pending caller |
| 1.3 | Pending account could assign itself a BSC | Resolved | `guard_profile_bsc_assignment` (044); replay check |
| 1.4 | Client treated missing or unknown status and role as approved (fail-open) | Resolved | `4863346`; `authFailClosed.test.ts`: 38 pass, 27 fail on the old `auth.ts` |
| 1.5 | `create-test-users.js` could write to the production project | Resolved | `b72b1bd`; `seed-guard.cjs` refuses the production ref before any network call; 11 script tests pass |
| 1.6 | Certification harnesses could target the production project | Resolved | `5216b89`; `lib.mjs` and `auth/lib.mjs` refuse `yziuhtxtznginhdpqurb` before any override |
| 1.7 | Certification failures (7 on `main` run 39987069877) | **Open** | See "Certification status" below |
| 1.8 | Integration PRs (#85, #89–#91, #93, #94, #17, #84, #80, #81, #79) | Not ported | Different migration lineage (039–106) and numbering collisions; owner decision (D5) |

### Wave 2: meetings and dashboard

| # | Finding | Status | Evidence |
|---|---|---|---|
| 2.1 | Month headings wrong (UTC month used for grouping) | Resolved | `0675e3d`; `reportingDates.test.ts`, `dateBoundaries.test.ts` (run under UTC, Toronto, Tokyo, Los Angeles) |
| 2.2 | "Today" and "tomorrow" labels computed in UTC | Resolved | `0675e3d`; `MeetingCard.tsx` uses the Toronto day |
| 2.3 | Current-month and upcoming counts mixed past and future meetings | Resolved | `23b6848`; `meetingsPastUpcoming.test.ts`, `dashboardStatsSemantics.test.ts` |
| 2.4 | Misleading zero for unavailable metrics (cell attendance rate, unread count) | Resolved | `23b6848`: returns null, UI shows unavailable |

### Wave 3: membership and cells

| # | Finding | Status | Evidence |
|---|---|---|---|
| 3.1 | Pending and rejected accounts counted as members (directory, cell rosters, unassigned, devotional denominator, dashboard) | Resolved | `cd1b60e`; `membershipCounting.test.ts`: helpers, directory filter, devotional denominator, dashboard counts |
| 3.2 | Pending account can change its own cell, status or role | Resolved (verified) | Guard (022, 028) blocks each; replay checks 15, 16, 17 pass. Check 18 is the positive control (a pending account can still edit its name) |
| 3.3 | Rejected account can edit its own profile | Resolved (verified) | Policy requires `pending`; replay check 19 passes |
| 3.4 | **Active member cannot edit their own profile** (policy and guard disagree) | **Open**, confirmed | Probe on the replay: active self-update returns no error and the row is unchanged. 028's policy admits only `pending` rows, while the guard's comment allows `active`. Fix is an RLS policy change, which alters the schema fingerprint. Owner decision (D4) |
| 3.5 | Canonical member definition (approval state vs `people`/`memberships`) | **Open** | Approval state used everywhere. Owner decision (D1) |

### Wave 4: communications and ROR

| # | Finding | Status | Evidence |
|---|---|---|---|
| 4.1 | Open and click rates divided by all messages (failed and queued lowered the rate) | Resolved | `a6af0a6`; `emailDeliveryStats.test.ts` (9): sent-only denominator |
| 4.2 | Rate shown as 0% when nothing was sent | Resolved | Shows a dash; tests cover the empty and no-sent cases |
| 4.3 | Open-rate caveat and window not stated | Resolved | Page caption: 200-row window after status filter; images-blocked undercount; sent base |
| 4.4 | Delivered and bounced shown as verified | Resolved | Not displayed as verified. The status filter still lists "bounced". The send function writes `queued`, `sent`, `failed` and `skipped` (`supabase/functions/send-email/index.ts`). Nothing in the repo writes `bounced` |
| 4.5 | Devotional views and "Mark as read" recorded the UTC day, and the click day, not the page day | Resolved | `a6af0a6`; `devotionalPageDates.test.tsx` (8), including a hook test: a past page is recorded for its own date |
| 4.6 | Viewer's default day and "today" used the browser clock, not the Toronto day | Resolved | `DevotionalViewer.tsx` now uses the Toronto calendar |
| 4.7 | ROR streak RPC sent the UTC day and month | Resolved | `rorReportingDates.test.ts`: fetch wiring sends `2026-11-30` and `2026-11` at 21:30 Toronto |
| 4.8 | `last_completed` (SQL date) parsed as UTC midnight, shown a day early in Toronto | Resolved | `formatRorDay`, `daysBetweenKeys`; tests cover the shifted-day case |
| 4.9 | ROR presented as verified attendance | Resolved | Labelled "self-reported" on the badge, calendar, progress table and viewer |
| 4.10 | Relay bearer token compared with `!==` | Resolved | `a6af0a6`; `secretsMatch()` (SHA-256 + `timingSafeEqual`); 7 unit tests and 2 `validateRequest` tests |
| 4.11 | Other UTC date uses in the app (habits, contact forms, meeting form, confessions, books, email templates) | **Open**, out of this wave | Listed for follow-up; not changed |

Not verified: the ROR and devotional date fixes are checked by Jest with pinned clocks. They were not re-run against the
pre-fix code. A browser check in the Toronto evening was not run.

### Wave 5: attendance schema

| # | Finding | Status | Evidence |
|---|---|---|---|
| 5.1 | The client reads and writes `attendance_status`, which main's schema does not define | **Open** (evidence in place) | `attendance_schema_pglite.mjs` checks 5 and 6: `42703` on both statements. Defined by migration 074 on the integration lineage only |
| 5.2 | Attendance read failure showed every meeting as "not confirmed", with a "Confirm Attendance" button | Resolved | `fe7fcfc`; `attendance_status_unavailable` flag; card shows "unavailable" with no button; 2 query tests, 2 component tests |
| 5.3 | Do not add `attendance_status` or remove `attended` before the model is decided | Honoured | No schema change in this branch. `attended` is checked as readable and writable (checks 3, 4) |
| 5.4 | Twice-weekly report mechanism | **Not found** | No cron migration, no workflow `schedule:`, no caller of `process-scheduled-emails`. `docs/database-and-identity.md` records scheduled email as inactive. Nothing to disable in this repo. Owner to confirm where it runs (D7) |

## Certification status

- CI cannot be re-run here: Docker is forbidden by the directive, so the Docker-based certification jobs have not run on this
  branch.
- Last recorded `main` run (39987069877): 23 passed, 7 failed.
- On this branch, `bscs_read` is addressed by migration 044 (Wave 1). The other six failures involve the schema contract and
  the golden fingerprint. They are not changed, because the directive forbids editing the contract assertions or regenerating
  the golden fingerprint to make CI pass. They need owner review (D6).
- Hosted production schema was not verified. The Supabase connector returned "You do not have permission" for the production
  project. The only project it listed (NEXUS) is a different lineage, and it was not queried.

## Owner decisions

| ID | Decision | Current state on the branch |
|---|---|---|
| D1 | Canonical member definition: approved account (`profiles.status = 'active'`) or `people`/`memberships` (migration 015) | Approval state, applied consistently |
| D2 | `profiles.status` default: 016 sets `'active'`, 019's `handle_new_user` creates `pending` | Unchanged; confirm which is intended |
| D3 | Attendance model: adopt 074 (port it with 061, 072, 073) or keep `attended` and derive states from `confirmed_at` | Unchanged; the write path still uses `attendance_status`, which fails on main's schema |
| D4 | Let an active member edit their own ordinary profile fields (new RLS policy; changes the schema fingerprint) | Unchanged; confirmed gap (3.4) |
| D5 | Migration lineage: main 000–044 versus the integration lineage 039–106, with colliding numbers (for example PR #85's 043) | Not merged; main numbering kept |
| D6 | Six schema-contract and golden-fingerprint items in certification | Unchanged; need review |
| D7 | Where the twice-weekly report runs, if it exists outside this repo | Not located |
| D8 | Hosted production schema check (needs access to the BLW York production project, read-only) | Not done |

## Remaining blockers

1. D3 blocks the attendance write path (5.1). Until it is decided, check 5 and 6 document the defect.
2. D4 blocks active-member self-service profile edits (3.4).
3. D6 blocks a green certification run.
4. D8 blocks confirming the production schema matches main.
5. Docker is needed to run the certification jobs. It is out of scope under this directive.

## Not done in this branch

- No migration applied anywhere. No production access.
- No PR merged or closed. No merge into `main`. Nothing pushed.
- No change to certification assertions, the schema contract or the golden fingerprint.
- No test users created.

## Unified platform consolidation (2026-11-27)

The unified platform (`f4972e0`, from `claude/youthful-heisenberg-a2a3mu`) is consolidated into this branch by a merge
commit. Nothing was force-pushed. The merge reconciles the interrupted Safari repair (`b8c0232`) with the unified
service worker. The Safari repair's fetch policy, legacy cleanup, login fixes and tests are kept. The unified work adds
the `/hub` scope, the public root, and the root retirement workers.

### Decisions applied

| ID | Decision | Applied in |
|---|---|---|
| U1 | `/` public website; `/events` public events; `/hub` member Hub; `/hub/login` sign-in; `/hub/events` internal Hub events; `/admin` administration; `/api/*` approved endpoints | `vercel.json`, `src/App.tsx`, email and Edge Function links |
| U2 | Public `/events` takes precedence over the historical internal `/events` route; it is not a legacy redirect | `vercel.json` (no `/events` redirect); route check |
| U3 | Other compatible legacy redirects preserved (307): members, cells, announcements, devotionals, profile, email-preferences, books, contacts, confessions, testimonies, meetings, messages, habits, growth, login, reset-password | `vercel.json`; `scripts/verify-unified-routes.mjs` |
| U4 | Hub service worker scoped to `/hub/`; root-scope legacy workers (`/sw.js`, `/service-worker.js`) retired; Hub caches only | `public/service-worker.js`, `site/public/sw.js`, `pushServiceWorker.ts` |
| U5 | Retirement deletes only Hub-owned caches (`blw-hub-*`, `blw-york-*`, `cc-portal-*`). Origin caches owned by other features are not deleted | `site/public/sw.js`, Hub worker activate |

### Verification (local, on the consolidated tree)

| Check | Result |
|---|---|
| Hub TypeScript | Pass |
| Hub Jest (CRA, CI=true) | 540 pass, 11 skipped (the real-Supabase tests, unchanged) |
| Public site Vitest | 190 pass |
| Script tests (`npm run test:scripts`) | 21 pass, including 8 Hub service-worker tests |
| Production build (CI=true) | Pass |
| Route verification (`npm run verify:routes`) | All pass |
| Unified browser suite, Chromium desktop and iPhone-sized viewport, production-style routing | 20 pass |
| Existing e2e: login regression, auth, mobile navigation (Chromium) | 50 pass |
| Database authorization (PGlite) | 19 pass (from the unified commit; the Hub database code was not changed here) |

### WebKit and real-device status

- WebKit is not installed in this environment. Only Chromium is available, and the environment forbids reinstalling
  Playwright. The `webkit-iphone` project in `playwright.config.ts` therefore did not run here.
- The Chromium iPhone-viewport tests simulate layout and rendering only. They are not Safari.
- Real iPhone Safari has not been tested. The iPhone sign-in failure stays unverified on a real device until someone
  signs in on an iPhone and confirms the failure is gone.

### Blockers for production (unchanged or new)

1. **Connected Preview not opened.** No Vercel access exists in this environment (no CLI, token, or connector). Environment
   isolation cannot be verified. The PR #97 body records that the Preview currently embeds the production Supabase URL, and
   that the committed workflows label `yziuhtxtznginhdpqurb` as Preview while the production guards name it as BLW York
   production. This must be resolved before any connected Preview is opened.
2. **Vercel routing not tested on a live deployment.** The routing rules are verified through a model of the documented
   `vercel.json` rules and a local server. Confirm on a Preview deployment once item 1 is resolved.
3. **Supabase Auth redirect URLs.** Add `<origin>/hub/reset-password` and `<origin>/hub/**` to Supabase URL configuration.
   Keep the legacy `/reset-password` if emails already sent must work.
4. **Edge Function redeploy.** `supabase/functions/_shared/event-notification.ts` now emits `/hub/events`. It is not deployed.
5. **Still open from earlier waves:** D3 (attendance model), D4 (self-service profile edits), D6 (certification
   assertions), D8 (hosted production schema check). Unchanged by this consolidation.
6. **Not run here:** the 11 environment-gated real-Supabase tests, the remote schema comparison, the migration rehearsal
   on isolated staging, and backup or PITR readiness. Each needs isolated infrastructure.

### Not done in this consolidation

- No production write, migration, deployment or merge into `main`.
- No domain purchase. No deletion or retirement of either Vercel project.
- No new branch, worktree or PR (PR #97 is updated by the push to its branch).
