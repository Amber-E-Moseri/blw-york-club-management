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

Verification on this candidate: `deno check` passes for all four functions. `deno test` passes 30 tests (18 black-box, 12 unit)
against a stub of the Supabase and Turnstile endpoints. These run in CI as the `edge-functions` job. Live Turnstile and live
Supabase are not exercised.

Trust boundary (resolved in this candidate): the client address is read only from `cf-connecting-ip`, and only when
`WEBSITE_TRUSTED_PROXY=cloudflare`. `x-forwarded-for` and `x-real-ip` are no longer read. Without a trusted proxy the
per-client limits are skipped. Turnstile and the database's global per-kind limits still apply. Add `WEBSITE_TRUSTED_PROXY`
(optional) to the inventory for `website-inquiry` and `website-rhapsody-pdf` if the public site is proxied by Cloudflare.

Also check the production secrets exist before deployment: `CLIENT_HASH_SECRET`, `TURNSTILE_SECRET_KEY`,
`WEBSITE_ALLOWED_ORIGINS`, `WEBSITE_PUBLIC_URL`.

## 6. Live functionality matrix (status on the candidate, see the branch head)

Only rows marked "CI" or "PGlite" were executed. Everything else is NOT RUN.

| Capability | Verification | Status |
|---|---|---|
| PostgreSQL 17 golden fingerprint | Regenerated by update-golden-fingerprint on the candidate head (migrations 000-059); see section 7, item 1 | Pending regeneration and commit |
| 11 previously skipped Supabase integration tests (`quickAddRealCode`) | CI `certification` job, local Supabase stack | PASS 11/11 on `de0aa29` |
| Storage certification (local stack) | CI `certification` job | PASS 30/30 on `de0aa29` |
| Storage certification (hosted Preview) | `storage_certification.mjs` against the Preview project | NOT RUN: `hosted-certification.yml` is frozen (`if: false`) and the Preview project is not visible to this account |
| Role lifecycle (migrations 058 and 059) | PGlite: `website_roles_pglite.mjs` 35/35, `website_roles059_pglite.mjs` 34/34 | PASS |
| CMS authorization | PGlite and CI | PASS 216/216 (D2) |
| Website Edge Functions | `deno check` and `deno test` (stubbed upstream), CI `edge-functions` | PASS 30 tests |
| Admin login, content edit, publish, image upload, events, inquiries on a hosted Preview | live | NOT RUN (no isolated Preview project reachable) |
| Public inquiry through Turnstile | live | NOT RUN |

## 7. Remaining release blockers

1. Golden fingerprint: regenerate on the candidate head with `update-golden-fingerprint` (pins set to 60 migrations ending
   at 059), review the artifact against the reviewed contract, and commit it. Then run full CI on that commit.
2. Hosted Preview project: the Preview Supabase reference in Vercel (`yziuhtxtznginhdpqurb`, also `CERT_EXPECTED_PROJECT_REF`)
   is not visible to the authenticated Supabase account, and `hosted-certification.yml` is disabled. Owner action: confirm
   the Preview project, grant access, and decide whether the frozen hosted workflows may run against it.
3. Production migration ledger (section 1): a read-only query of `supabase_migrations.schema_migrations`, run by the owner in
   the Dashboard. Not obtained here.
4. Migration 059 (resolved in this candidate, pending deployment): it refuses empty and null permission sets at creation,
   guards the last website permission against every path (RPC, direct table write, cascade), and keeps retirement working
   for the retiring role only. Positive and negative regression: `website_roles059_pglite.mjs`, 34/34.
   Existing empty roles are not changed. Find them with `supabase/verification/website_empty_roles_report.sql` (read-only).
   Recovery is documented in that file: set intended permissions, or retire the role through the audited RPC. Operational
   roles with no permissions are listed too, so review by name before acting. Owner action: decide per row.
5. Connected acceptance (section 6): no hosted Preview to demonstrate content edits, uploads, events and inquiries.
6. Auth allowlist (section 4) and Edge Function deployment (section 5): owner actions. The four functions are not deployed
   or tested against a live Supabase.
7. Hotfix commit `25e9673` (branch `hotfix/p0-login-null-response`, separate worktree): not reviewed here.
8. Real-device iPhone sign-in (not tested here).
9. `pg17-certify-000-103.yml` and `preview-migrations.yml` pin other candidate trees (`fada4a3`, `faa9474`). They do not
   apply to this 000-059 tree and were left unchanged.

## 8. Decision

- Development: GO for continued integration on the remediation branch, once the PostgreSQL 17 golden is committed.
- Production: NO-GO.
