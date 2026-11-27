# P0 hotfix: iPhone Safari sign-in failure

Branch: `hotfix/p0-login-null-response`. Base: `9e57c54`, the production source commit (`main`).
Status: **hotfix preparation only. Not merged, not deployed.** Deployment needs explicit owner approval.

## The failure

On iPhone Safari, submitting the sign-in form showed `Returned response is null.` The service worker answered the
password request (`POST /auth/v1/token`) from cache when the network request failed. `caches.match` resolves to
`undefined` on a miss, so `respondWith` received no `Response`. The worker code in the pre-fix build is
`fetch(request).catch(() => caches.match(request))`.

## What the hotfix changes

| Area | Change |
| --- | --- |
| `public/service-worker.js` | Answers only GET requests for hashed same-origin `/static/` files, cache-first. Never intercepts Supabase, `/api/`, POST/PUT/PATCH/DELETE, navigations, or requests with `Authorization`. A failed fetch resolves to `Response.error()`, never `undefined`. Activate deletes only Hub-owned caches (`blw-york-v<n>`, `cc-portal-v<n>`), not other apps' caches. Push and notification-click handlers are unchanged. |
| `public/sw.js` | Retired legacy worker. Installs, deletes only Hub-owned caches, then unregisters itself. No fetch handler. |
| `src/lib/serviceWorker/pushServiceWorker.ts`, `src/index.tsx` | On load, unregisters any registration running `/sw.js`, then registers `/service-worker.js`. Registration failure is logged and does not break the app. |
| `src/lib/auth.ts` | Friendly messages only: network failures show "We could not reach the sign-in service…", rate limits and invalid credentials have plain wording, and raw browser errors are never shown. **No change to authentication or authorization rules.** |
| `src/hooks/useAuth.ts` | Session restore and profile-load failures end the loading state and show a message. |
| `src/pages/Login.tsx` | Explicit light and dark colours for the card, heading, labels, and primary button. Safe-area padding. A ref guard refuses a second submit while a sign-in request is in flight. |
| `src/components/foundation/Input.tsx`, `src/styles/globals.css` | Label contrast in dark mode. Autofill styling. `color-scheme` set per theme. |

Not included: `/hub` routing, the unified platform (`f4972e0`), and any database migration or dependency upgrade.

## Automated verification (candidate build)

Candidate = this branch's `build/` output. Served by `e2e/support/buildServers.cjs` on dedicated ports 4173 (static)
and 4174 (local auth stand-in that drops the password request at the socket). Pre-fix control = `main` 9e57c54,
built from a clean `git archive` with `core.autocrlf=false`.

| Check | Result |
| --- | --- |
| Typecheck (`tsc --noEmit`) | Pass |
| Full Jest, all applicable suites | 44 suites passed, 1 pre-existing suite skipped. 382 tests passed, 11 pre-existing skips. |
| Service worker suites (`serviceWorkerAuthRegression`, `pushServiceWorkerRegistration`, `legacyServiceWorkerKillSwitch`) | 20 of 20 pass |
| Pre-fix worker against the same suite (negative control, earlier run) | 10 of 12 fail |
| Production build | Compiled successfully. Served bundle hash checked against `build/index.html`. |
| Chromium, candidate | 10 of 10 pass |
| WebKit iPhone 13 profile, candidate | 10 of 10 pass |
| Chromium, pre-fix control | 3 expected failures: dark-text contrast 1.10:1; raw "Failed to fetch" shown; double submit not blocked |
| WebKit iPhone 13 profile, pre-fix control | Reproduces the reported alert: "FetchEvent.respondWith received an error: Returned response is null." |
| Legacy upgrade (`/sw.js` → `/service-worker.js`), Chromium and WebKit | Pass. Legacy registration removed. `cc-portal-v1` and `blw-york-v1` deleted. `other-app-cache-v3` kept. Session kept. |

Limits of the automated checks:

- WebKit with the iPhone 13 device profile is not a physical iPhone. It does not prove iOS Safari behaviour on a device.
- Playwright does not expose a service worker's own console. The "Returned response is null" log line cannot be captured in the browser tests. The pre-fix worker's null response is covered in `serviceWorkerAuthRegression.test.ts`, and the pre-fix browser control shows the same message in the alert.
- The auth server is a local stand-in. Real Supabase sign-in was not exercised.

## iPhone verification procedure (device, not yet performed)

Needed before the owner can judge the hotfix on iOS. Record each result.

1. Prepare the device: iPhone running iOS (record the version), Safari (record the version). Sign out of the Hub. Test one account that exists in production, and one wrong password. Do not test with real member data beyond the owner's own account.
2. Open the Preview or production URL the owner names. For a device that used the site before the fix, also do step 7.
3. Wrong password: enter a known-wrong password and tap Sign In. Expected: "Incorrect email or password. Please try again." Not expected: any text containing "Returned response is null", "respondWith", or "Load failed".
4. No network: turn on Airplane Mode and tap Sign In with correct details. Expected: "We could not reach the sign-in service…". Turn Airplane Mode off.
5. Correct password: sign in. Expected: the app opens. Sign out and sign in again.
6. Double tap: tap Sign In twice quickly. Expected: one sign-in attempt. With Web Inspector connected (Mac Safari → Develop → the iPhone → the page → Network), expect one `POST …/auth/v1/token` for that attempt.
7. Legacy device: on a device that had the site open before this fix, open the site, then check Web Inspector → Storage → Service Workers. Expected: only `/service-worker.js` registered, no `/sw.js`. Notification permission still works.
8. Appearance: switch iOS to Dark, reload. Heading, labels, field text, and the button are readable. Switch to Light and check again.
9. Small screen: test on an iPhone SE or in Safari's responsive mode at 320px. The sign-in card keeps a visible margin from the screen edge.
10. Write up: device model, iOS, Safari version, URL, time, each step's result, and a screenshot of any failure.

## Deployment procedure (requires explicit owner approval)

Preconditions:
- Owner has approved the release gate report.
- Preview deployment has been checked. No Preview deployment has been made yet, because the Preview environment's Supabase
  configuration has not been verified. A Preview must point at a non-production backend or be confirmed safe first.
- No database migration. No environment variable change.

Steps:
1. Record the live production deployment before anything else: `vercel ls blwyork --prod` and note the newest READY
   deployment URL. Call this `<PREVIOUS_PROD_URL>`.
2. Deploy the hotfix commit as production only after approval. From the hotfix worktree, run `vercel deploy --prod`
   (confirm the project and team with `vercel link` output first).
3. Check the new deployment with the procedure above, steps 3 to 6, on a real iPhone.
4. Confirm the served bundle: `vercel inspect <NEW_URL>` shows the new deployment, and the bundle name in
   `index.html` matches the candidate build.

## Rollback

1. Re-promote `<PREVIOUS_PROD_URL>` as production. Check the exact command with `vercel promote --help` (or `vercel rollback --help`, depending on the CLI version) before running it.
2. Rolling back restores the earlier front end, including its service worker. The sign-in failure returns. This is expected: rollback does not change data.
3. No database or environment rollback is needed, because none was changed.

## Remaining risks

- **Not device-tested on iPhone.** Only WebKit with an iPhone 13 profile has been run.
- **Authentication rules on `main` are not the remediation rules.** `main`'s `src/lib/auth.ts` does not contain the fail-closed
  role and status checks on `remediation/blw-york-wave1-5`, and `buildProfile` treats a missing status as `'active'`.
  The directive forbids changing authentication rules in this hotfix, so the production build inherits that gap. Fixing it is a
  separate change that needs its own certification.
- Browser tests use a local auth stand-in, not Supabase.
- Preview deployment was not made.
- The pre-fix worker's null response is shown by the WebKit control, and by unit tests. It is not captured as a console line in the browser tests.
