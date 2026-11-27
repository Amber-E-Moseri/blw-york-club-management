# Production readiness: website CMS (migrations 047-058)

Production is on HOLD. Nothing in this document has been applied to production, and nothing here authorises a production
change. Every production item below needs a separate, explicit owner directive.

## 1. Migration ledger (NOT verified)

Migrations 047-058 are on the remediation branch only. They must not be assumed to exist in production.

Read-only comparison to run by the owner, against the production project (`rjtstjmtddqhesexltbj`, verified spelling):

1. List the applied migration versions from the production migration history (read-only SQL against
   `supabase_migrations.schema_migrations`, or the Dashboard migration list). Save the output.
2. Compare that list with `supabase/migrations/` on the remediation commit. Expected: 000-046 applied (or the documented
   gaps from decision D5), and 047-058 absent. Any other difference stops the work.
3. Run `supabase/verification/schema_fingerprint.sql` read-only against production and compare with the PostgreSQL 17
   golden once it is committed (`check_schema_contract.mjs <prod-fingerprint> --golden <golden>`). A difference means
   production has drifted from the reviewed schema; stop.

Blocked here: no production access.

## 2. Migration rehearsal (partial)

- Done locally (PGlite, in-process): the full chain 000-058 replays with no error; the CMS authorization suite (216),
  the role suite (35), the Wave 1 authorization suite (19), attendance (9), membership (7) and the contract (29) pass.
- Not done: a rehearsal of the production-to-candidate path on an isolated staging copy of production. Needs an isolated
  project and owner approval. Required before any production apply.

## 3. Backup and recovery (NOT verified)

Before any production migration, the owner must confirm in the Supabase Dashboard:

1. Point-in-time recovery (PITR) is enabled for `rjtstjmtddqhesexltbj`, and the retention window covers the change window.
2. A logical backup taken immediately before the change, stored outside the platform, with a restore test on the staging
   copy.
3. Recovery sequence: (a) pause writes (maintenance page on the Hub), (b) restore to the pre-change point if a migration
   fails, (c) re-run the ledger comparison, (d) resume writes only after the comparison matches.

Blocked here: no Dashboard or backup access.

## 4. Supabase Auth callback changes (owner action)

In Supabase Dashboard, Authentication, URL Configuration:

- Site URL: the deployment origin (production or the chosen domain).
- Redirect URLs to allow:
  - `<origin>/hub/reset-password`
  - `<origin>/hub/**`
  - keep `<origin>/reset-password` only while emails sent before the unified platform must still work.
- Email templates: confirm the recovery and confirmation links use `{{ .SiteURL }}` (not a hardcoded host).

The code already sends recovery to `${origin}/hub/reset-password` (`src/lib/auth.ts`). Without the allowlist entry,
Supabase will refuse the redirect.

## 5. Edge Function deployment inventory

Functions that must be deployed to the target project for this release (`verify_jwt` as set in `supabase/config.toml`):

| Function | verify_jwt | Change in this release | Secrets it reads |
|---|---|---|---|
| `notify-event` | (existing) | Event push links now `/hub/events` (`_shared/event-notification.ts`) | existing |
| `notify-announcement` | (existing) | Shared notification code updated for the unified routes | existing |
| `website-inquiry` | false | New on this lineage (public inquiry intake, Turnstile, rate limit) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `CLIENT_HASH_SECRET`, `WEBSITE_ALLOWED_ORIGINS` |
| `website-media-upload` | true | New (authorised uploads to `site-media` and `rhapsody-pdfs`) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBSITE_ALLOWED_ORIGINS` |
| `website-media-cleanup` | false | New (orphan detection and reference-aware removal) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `website-rhapsody-pdf` | false | New (private PDF access for published editions) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLIENT_HASH_SECRET`, `WEBSITE_PUBLIC_URL` (optional). The signed-link lifetime is a constant (120 s), not a setting. |

`website-guards.ts` is shared by the four website functions. Deploy with the functions, not separately.

Deployment must be done by the owner after review. No deployment was made here.

Verification on this candidate: `deno check` passes for all four functions. `deno test -A website-functions.test.ts` and
`deno test -A _shared/website-guards.test.ts` pass (27 black-box and 11 unit tests) against a stub of the Supabase
endpoints. The Turnstile success path is not exercised offline. These Deno tests are not yet wired into CI.

Also check the production secrets exist before deployment: `CLIENT_HASH_SECRET`, `TURNSTILE_SECRET_KEY`,
`WEBSITE_ALLOWED_ORIGINS`, `WEBSITE_PUBLIC_URL`.

## 6. Live functionality matrix (status on candidate `de0aa29`)

Only rows marked "CI" or "PGlite" were executed. Everything else is NOT RUN.

| Capability | Verification | Status |
|---|---|---|
| PostgreSQL 17 golden fingerprint | `schema_fingerprint.golden.json` from run 45923420633 (for `f4692d5`) | Committed in `de0aa29`; CI parity check passes 30/30 |
| 11 previously skipped Supabase integration tests (`quickAddRealCode`) | CI `certification` job, local Supabase stack | PASS 11/11 on `de0aa29` |
| Storage certification (local stack) | CI `certification` job | PASS 30/30 |
| Storage certification (hosted Preview) | `storage_certification.mjs` against the Preview project | NOT RUN: `hosted-certification.yml` is frozen (`if: false`) and the Preview project is not visible to this account |
| Role lifecycle (migration 058) | PGlite, `website_roles_pglite.mjs` | PASS 35/35; see section 7, item 3 for two gaps |
| CMS authorization | PGlite and CI | PASS 216/216 (D2) |
| Website Edge Functions | `deno check` and `deno test` (stubbed upstream) | PASS (see section 5); not run against a live stack |
| Admin login, content edit, publish, image upload, events, inquiries on a hosted Preview | live | NOT RUN (no isolated Preview project reachable) |
| Public inquiry through Turnstile | live | NOT RUN |

## 7. Remaining release blockers

1. Hosted Preview project: the Preview Supabase reference in Vercel (`yziuhtxtznginhdpqurb`, also `CERT_EXPECTED_PROJECT_REF`)
   is not visible to the authenticated Supabase account, and `hosted-certification.yml` is disabled. Owner action: confirm
   the Preview project, grant access, and decide whether the frozen hosted workflows may run against it.
2. Production migration ledger (section 1): needs a read-only query of `supabase_migrations.schema_migrations` run by the
   owner in the Dashboard. Not obtained here.
3. Migration 058 gaps (found by a PGlite probe, not yet fixed):
   a. `web_create_website_role` accepts an empty permission set. The role can never be retired (`web_retire_website_role`
      refuses a role with no website permission, and `web_set_website_role_permissions` refuses an empty set).
   b. Proposed fix: a forward migration 059 that rejects an empty permission set in `web_create_website_role`, plus a
      decision on any existing empty roles. A new migration changes the reviewed tree, so the golden must be regenerated
      through CI.
   Verified enforced: a direct table DELETE of a still-assigned website role affects no rows (RLS); a direct INSERT of a
   website key is refused by RLS; RPC retirement refuses assigned, built-in and non-website roles.
4. Connected acceptance (section 6): no hosted Preview to demonstrate content edits, uploads, events and inquiries.
5. Auth allowlist (section 4) and Edge Function deployment (section 5): owner actions. The four Deno functions are not
   deployed or tested against a live Supabase. Trust note: `clientAddress` takes `cf-connecting-ip`, then the first
   `x-forwarded-for` entry. Outside Cloudflare a caller can set those headers, which weakens the per-client limits.
   Confirm the Supabase gateway's header behaviour before relying on the limits.
6. Hotfix commit `25e9673` (branch `hotfix/p0-login-null-response`, separate worktree): not reviewed here.
7. Real-device iPhone sign-in (not tested here).
8. `pg17-certify-000-103.yml` pins a different candidate (`fada4a3`, 104 migrations) and golden blob `8dc3943`. It does not
   apply to this 000-058 tree and was left unchanged.

## 8. Decision

- Development: GO for continued integration on the remediation branch, once the PostgreSQL 17 golden is committed.
- Production: NO-GO.
