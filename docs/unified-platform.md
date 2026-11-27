# Unified BLW York platform

One deployable application serves the public website, the Hub and administration from one origin. No custom domain
is required for the build or the preview. The domain is set in Vercel and Supabase when it is purchased (section 7).

## 1. Route inventory

| Path | Served by | Notes |
| --- | --- | --- |
| `/` and public pages (`/about`, `/events`, `/events/:slug`, `/rhapsody`, `/rhapsody/:slug`, `/foundation-school`, `/blog`, `/blog/:slug`, `/new-here`, `/contact`) | Public website (`site/`) | Anonymous. Uses the public anon key only. Noindex until the approved launch. |
| `/hub`, `/hub/login` | Hub (`src/`) | Sign-in when signed out. Pending, rejected and inactive accounts see the approval screen. |
| `/hub/events`, `/hub/members`, `/hub/cells`, `/hub/announcements`, `/hub/devotionals`, `/hub/profile`, `/hub/email-preferences`, `/hub/books`, `/hub/contacts`, `/hub/confessions`, `/hub/testimonies`, `/hub/meetings`, `/hub/messages`, `/hub/habits`, `/hub/growth` | Hub member routes | Every member route is under `/hub`. |
| `/hub/reset-password` | Hub | Password recovery landing. |
| `/admin`, `/admin/*` | Hub | Administration. Hub admin pages and Website Management (`/admin/website/*`). Each page and each database call is authorized. |
| `/api/*` | Vercel functions (`api/`) | `/api/email-relay`. |
| `/hub/static/*`, `/assets/*` | Build assets | A missing asset returns 404. It never returns the HTML shell. |
| `/hub/service-worker.js` | Hub service worker | Scope `/hub/`. |
| `/service-worker.js` | Legacy retirement worker | Removes the old root-scope Hub worker. See section 4. |

### Legacy redirects (307, query and fragment preserved)

`/members`, `/cells`, `/announcements`, `/devotionals`, `/profile`, `/email-preferences`, `/books`, `/contacts`,
`/confessions`, `/testimonies`, `/meetings`, `/messages`, `/habits`, `/growth`, `/login`, `/reset-password` redirect to
the same name under `/hub`. The fragment carries Supabase recovery tokens, and a redirect keeps the fragment.

Deliberate exception: `/events` is the public events page, so it is not a legacy redirect. Hub events are at
`/hub/events`. Old Hub links and notifications to `/events` open the public events list. This is a decision for the
owner to confirm.

Legacy Hub root `/` cannot redirect, because `/` is now the public homepage. A standalone-mode launch of an installed
legacy app is redirected to `/hub` by `site/public/hub-pwa-entry.js`. A browser visit to `/` is not affected.

## 2. Build pipeline

- `npm run build` runs `build:unified`:
  1. `build:site`: installs and builds `site/` (Vite, base `/`) into `site/dist/`.
  2. `build:hub`: builds the Hub (CRA, `homepage: "/hub"`) into `build/`, so assets resolve under `/hub/`.
  3. `scripts/assemble-unified.mjs`: writes `dist/` with the public site at the root and the Hub at `dist/hub/`.
- `vercel.json` sets `outputDirectory: "dist"`, the redirects, the rewrite order, and the headers.
- Rewrite order: static files first (Vercel default), then `/hub` and `/admin` SPA fallbacks, then the public SPA
  fallback. The public fallback excludes `hub`, `admin`, `api` and `assets`, so no public route swallows the Hub.
- Headers: `X-Robots-Tag: noindex, nofollow` on every response, which keeps the existing fail-closed indexing policy.
  The public site's Content-Security-Policy applies to public paths only. The Hub has no CSP, as before.
- Asset collisions: the Hub's CRA output is under `/hub/`. The public Vite output is at the root (`/assets/`). Neither
  can overwrite the other. `assemble-unified.mjs` fails if an expected file is missing.

## 3. Verification evidence

Commands are run from the repository root. Production HOLD is in effect: no deployment, no migration, and no production
database access was performed.

| Check | Command | Result |
| --- | --- | --- |
| Route inventory and Vercel rule order (60+ expectations) | `npm run verify:routes` | All pass |
| Public site build | `npm --prefix site run build` | Pass |
| Hub typecheck | `npm run typecheck` | Pass |
| Hub unit tests | `CI=true npx react-scripts test --watchAll=false` | 540 pass, 11 skipped (the real-Supabase tests, skipped as before) |
| Public site unit tests | `npm --prefix site test` | 190 pass in 15 files |
| Service-worker regression | `npm run test:scripts` | 21 pass, including 8 for the Hub worker (section 4) |
| Database authorization (PGlite, no live database) | `npm run test:db:authz` | 19 pass |
| Existing Hub e2e: login regression, auth and mobile navigation (Chromium) | `npx playwright test e2e/login-regression.spec.ts e2e/auth.spec.ts e2e/mobile-navigation.spec.ts --project=chromium` | 50 pass |
| Unified browser suite (desktop and mobile Chromium, demo-content build, `vercel.json` routing emulated locally) | `npx playwright test -c playwright.unified.config.ts` | 20 pass |

The browser suite covers: the public homepage and its Hub sign-in entry, direct navigation and refresh on public and Hub
routes, legacy redirects, `/admin` for a signed-out visitor, service-worker scope and absence of worker errors, no
public worker, and no horizontal scroll at phone width.

Not run in this environment:
- WebKit/Safari. WebKit is not installed in this environment, and the environment forbids reinstalling Playwright.
  The `webkit-iphone` project did not run. The iPhone Safari fix is covered by code and Chromium tests only. A real
  iPhone sign-in is still required before the fix is called verified.
- `release-smoke.spec.ts` needs a local Supabase stack and a service-role key. It was not run.
- The 11 skipped Hub Jest tests are the real-Supabase tests. They remain skipped.
- The Vercel deployment itself. The routing module is a faithful model of the documented `vercel.json` rules, not a live
  Vercel run. Confirm on a Preview deployment.

## 4. Service worker (Safari "Returned response is null")

Cause: the old root worker (`/service-worker.js`) answered navigations and Supabase requests with
`fetch(req).catch(() => caches.match(req))`. When the network failed and the cache had no entry, `caches.match`
resolved to `undefined`, and `respondWith` received `undefined`. Safari reports this as the login error.

Fix:
- **Hub worker** (`public/service-worker.js`, served at `/hub/service-worker.js`, scope `/hub/`). It answers only GET
  requests for hashed `/hub/static/` bundles and images, cache-first, and caches only successful same-origin responses.
  Navigations, Supabase hosts, `/api/`, writes, and requests carrying an `Authorization` header are never intercepted.
  A failed fetch resolves to `Response.error()`. The cache name is versioned (`blw-hub-v3`). Activate removes only
  Hub-owned caches (`blw-hub-*`, `blw-york-*`, `cc-portal-*`), never caches owned by other features. Push handling and
  notification links are normalised under `/hub`.
- **Legacy retirement workers** (`site/public/sw.js` and an identical `site/public/service-worker.js`, served at the
  root). They replace an earlier root-scope worker on the next update check, delete only Hub-owned caches, and remove
  their own registration. They have no fetch handler. Remove them after most installs have updated, as a later cleanup.
  Hub-side cleanup (`src/lib/serviceWorker/pushServiceWorker.ts`) removes root-scope registrations running legacy script
  names. A registration at `/hub/` is never removed.
- The public site registers no worker.
- Registration uses `process.env.PUBLIC_URL`, so the Hub registers at `/hub/service-worker.js`.
- Manifest: `start_url` and `scope` are `/hub/`. Shortcuts and icons are under `/hub/`. Push and notification links
  are normalised under `/hub`.

Regression coverage (`scripts/__tests__/hub-service-worker.test.cjs`): auth and Supabase requests are not intercepted;
writes are not intercepted; paths outside `/hub/` are not intercepted; offline navigation and offline asset misses
resolve to a `Response`; a cached asset is served; notification paths are prefixed.

Login repairs from the remediation branch are kept: heading contrast, autofill contrast, light and dark styling, mobile card margins, friendly authentication errors, and duplicate sign-in prevention. They are covered by `e2e/login-regression.spec.ts` on Chromium only. WebKit and real-device checks are still required (section 3).

## 5. Authentication and authorization

- The Supabase authentication system is unchanged. There is no second auth system and no new user table.
- The Hub's session, pending, rejected and inactive gates are unchanged (`src/App.tsx`, `ProtectedRoute`). Access is
  still enforced by the app's role checks and by the database. The database authorization tests still pass.
- Administration is not reachable from a hidden link. `/admin` renders the Hub shell, and each admin page and query
  checks authorization. A signed-out visitor sees sign-in, not administration (browser test).
- The public site accepts only the anon key. It refuses a service-role key (`site/src/api/config.ts`, tested).
- Recovery and email links now point at `/hub/...`. Supabase must allow these URLs (section 6).

## 6. Configuration required before launch (no production change made here)

1. **Supabase Auth URL configuration** (Dashboard, Authentication, URL Configuration). Set the Site URL to the
   deployment's origin. Add these redirect URLs: `<origin>/hub/reset-password`, `<origin>/hub/**`. Keep the legacy
   `<origin>/reset-password` if already-sent emails must still work. Requires owner action on the production project.
2. **Edge Function**: `supabase/functions/_shared/event-notification.ts` now emits `/hub/events`. Redeploy the
   functions that use it, after review. Not deployed.
3. **Vercel environment variables** for the single unified project: the public site's `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, and `VITE_TURNSTILE_SITE_KEY`; the Hub's `REACT_APP_*` variables as today. Do not set
   `VITE_PREVIEW_DEMO` in production. It shows sample copy. The local verification build used it on purpose.
4. **Email links**: `src/lib/email/emailService.ts` falls back to a hardcoded origin when the window is unavailable.
   Set `REACT_APP_PUBLIC_APP_URL` to the deployment origin so server-side links resolve correctly.
5. **Turnstile**: the public inquiry widget's allowed hostnames must include the deployment domain.

## 7. Custom domain (when purchased)

Minimal configuration, with no code change:
1. In Vercel, open the unified project, Settings, Domains, and add the domain (for example `blwyork.ca`) and `www`.
   Set the DNS records Vercel shows. Choose the apex or `www` as primary and redirect the other.
2. In Supabase, add the new origin to the Site URL and redirect URLs (section 6, item 1).
3. Set `REACT_APP_PUBLIC_APP_URL` to `https://<domain>` in Vercel, and redeploy.
4. Check: `https://<domain>/`, `https://<domain>/hub/login`, a password reset email link, and the PWA install.
5. The public site's sitemap and canonical metadata were not changed in this pass. Check them before the indexing
   launch.

No code path depends on the domain. Same-origin relative URLs are used throughout, and the only absolute origin is the
email fallback above.

## 8. Retiring the separate public Vercel project

Do not delete anything until the owner approves each step.

1. Deploy the unified project to a Preview and run the checks in section 3 against it. Then obtain approval for production.
2. Keep the separate public project (`blw-york-public-site`) running and unchanged as a rollback target for at least
   one release cycle. The Hub's previous `/site` proxy to it has been removed from `vercel.json`.
3. Once the root is confirmed in production, remove the separate project's custom domain (if any) so there is one
   canonical address. Use a redirect from the old project's URL if it has public links.
4. Disable Git deployments for the separate project. Keep the project itself.
5. After an agreed period with no rollback, the owner may delete the separate project. This is not done here.
6. Remove `site/vercel.json` and the legacy root `service-worker.js` retirement worker once that period has passed.

## 9. Known decisions and gaps

- `/events` is the public events page. Hub events are at `/hub/events`. Confirm with the owner.
- The public site's standalone Admin branch (`site/src/admin`) is unreachable in the unified build, because `/admin` is
  served by the Hub. Website Management in the Hub is the one admin surface. The standalone code can be removed in a
  later cleanup.
- The Hub's `remediation/blw-york-wave1-5` branch is the base of this work. PR #97 has not been updated in this pass
  (see the commit message and summary).


## 10. Preview status (2026-11-27)

- Vercel Preview for PR #97: `https://blwyork-git-remediation-blw-yor-484c51-amber-e-moseris-projects.vercel.app`
  (project `blwyork`, Ready). Its Supabase backend is **not verified** as isolated. The PR states it embeds the
  production URL. Do not use this Preview for authentication, forms or writes until that is confirmed.
- Routes on that Preview were not checked from the build sandbox: egress returns 403 for `*.vercel.app`. Run section 3's
  checks from a machine that can reach the Preview.
- Vercel and Supabase connectors are not installed in this session, so the environment mappings could not be read
  from those integrations.
