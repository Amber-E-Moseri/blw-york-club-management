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
| `website-rhapsody-pdf` | false | New (private PDF access for published editions) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SIGNED_URL_SECONDS` (optional), `WEBSITE_PUBLIC_URL` |

`website-guards.ts` is shared by the four website functions. Deploy with the functions, not separately.

Deployment must be done by the owner after review. No deployment was made here. Deno was not available in this
environment, so the four functions have not been executed.

Also check the production secrets exist before deployment: `CLIENT_HASH_SECRET`, `TURNSTILE_SECRET_KEY`,
`WEBSITE_ALLOWED_ORIGINS`, `WEBSITE_PUBLIC_URL`.

## 6. Live functionality matrix (status on candidate `f4692d5`)

Only the rows marked PGlite were verified by execution. Everything else is NOT RUN.

| Capability | Verification | Status |
|---|---|---|
| Admin login to Hub | live | NOT RUN (no isolated backend) |
| Homepage content edit, draft invisible publicly | PGlite (draft invisible to anon) | PGlite pass; live NOT RUN |
| Publication and public refresh | PGlite (published body visible to anon) | PGlite pass; live NOT RUN |
| Image upload and replacement | PGlite (media rules, alt text, bucket rules) | PGlite pass; live NOT RUN |
| Public event creation and publication | PGlite (only open events publishable) | PGlite pass; live NOT RUN |
| Blog publication | PGlite (draft hidden, publish visible) | PGlite pass; live NOT RUN |
| Navigation and contact information | PGlite (settings publish reaches public view) | PGlite pass; live NOT RUN |
| Rhapsody content | PGlite (rhapsody suite) | PGlite pass; live NOT RUN |
| Public inquiry and admin inbox | PGlite (intake, consent, rate limit, inbox read) | PGlite pass; edge function NOT RUN (no Deno) |
| Website staff create, assign, revoke, retire | PGlite (role suite, 35) | PGlite pass; live NOT RUN |
| Ordinary member denial | PGlite (member and anon denied) | PGlite pass; live NOT RUN |
| Hosted storage certification | `storage_certification.mjs` | NOT RUN (needs hosted credentials) |
| 11 previously skipped Supabase integration tests | Jest (skipped, environment-gated) | NOT RUN (needs isolated project) |

## 7. Remaining release blockers

1. PostgreSQL 17 golden: artifact from run `45922814183` (for `40aa023`) and the run for `f4692d5` must be reviewed and committed.
   The artifact could not be downloaded from this environment (blocked by egress policy).
2. Connected Vercel Preview: no Vercel or Supabase connector in this session.
3. Live acceptance and hosted storage certification (section 6).
4. Production ledger comparison, rehearsal and backup verification (sections 1-3).
5. Supabase Auth allowlist (section 4) and Edge Function deployment (section 5).
6. Hotfix commit `25e96737` is not reachable from this repository. Push it to a branch so its duplicate-submit guard, contrast
   tests, legacy worker tests, session preservation and cache preservation can be reviewed against the unified `/hub` scope.
7. Real-device iPhone sign-in (not tested here).

## 8. Decision

- Development: GO for continued integration on the remediation branch, once the PostgreSQL 17 golden is committed.
- Production: NO-GO.
