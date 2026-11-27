# Website administration: verification and functionality matrix

Scope: the existing Website Management in the Hub (`src/website`, `/admin/website/*`) and the public website
(`site/`). No duplicate CMS, database or auth system. Production HOLD: no production write, migration or deployment.

## Summary

**The website backend is not on this branch.** This branch's migrations stop at `046`. The Hub and public clients
call `web_*` RPCs and `v_public_*` views that are defined only on another lineage, `origin/feat/website-cms-integ-106`
(migrations `107`-`116`, which diverge from this branch's `045`/`046`). Until that lineage is merged or otherwise
reconciled (decision D5), the Website Management screens and the public content connection have no backend here.

Live end-to-end tests against an isolated backend were **not run**. None is available in this session (no Supabase
project, no Docker, no connector). The database results below are from PGlite (in-process Postgres) on the CMS lineage.

## Build-time environment guard (item 1)

`scripts/check-supabase-config.mjs` runs before every unified build. It fails the build when:

- `VITE_SUPABASE_URL` and `REACT_APP_SUPABASE_URL` name different projects, or the anon keys differ
- one URL is set without its anon key (for either app)
- a Preview build points at the protected production project `rjtstjmtddqhesexltbj`
- a Preview build names an `EXPECTED_PREVIEW_SUPABASE_REF` that it does not use
- `VITE_PREVIEW_DEMO=true` is set in a production build

Tests: `scripts/__tests__/supabase-config.test.cjs` (8 cases). `npm run test:scripts`: 29 passing.

## Required objects (item 2)

| Object | On this branch | On the CMS lineage (`107`-`116`) |
|---|---|---|
| Website tables and views (`web_*`, `v_public_*`) | Missing | Defined |
| RPCs the Hub client calls (15 of 20 by name and argument keys) | Missing | Defined, argument keys match |
| RPCs the Hub client calls for roles (5) | Missing | **Missing**: the client calls `web_create_role`, `web_set_role_permissions`, `web_archive_role`, `web_assign_role`, `web_revoke_assignment`. The backend has `web_create_website_role`, `web_set_website_permission`, `web_unassign_website_role` and `web_assign_website_role` with a different model (per-permission grants, no versioning, no archive). |
| Storage buckets `site-media` (public images), `rhapsody-pdfs` (private PDFs) | Missing | Defined in `110` |

## Database results (PGlite replay of the CMS lineage, 000-116)

`supabase/verification/website_cms_integ_test.mjs`: **216 of 216 passed.** This tests the backend's permission model,
not this branch. Results by area:

| Area | Checks | Result |
|---|---|---|
| Content (page drafts, publish, versions, rollback, optimistic concurrency) | 26 | Pass |
| Settings | 9 | Pass |
| Navigation (via settings and content kinds) | counted in content and settings | Pass |
| Blog posts | 10 | Pass |
| Events (public publication, featuring, meeting-targeted events refused) | 8 | Pass |
| Unpublish | 14 | Pass |
| Inquiries (intake, consent, honeypot, rate limit, no CRM rows, reviewer access) | 16 | Pass |
| Media (alt text, MIME and bucket rules, upload permission, orphan detection) | 16 | Pass |
| Roles and revocation (core-admin only; no self-grant) | 31 | Pass |
| Coordinator and audit | 14 | Pass |
| Privacy and authority | 5 | Pass |
| Rhapsody, edge functions, link rules | 56 | Pass |

## Functionality matrix

Status key. **DB** = database test on the CMS lineage. **Live** = verified end-to-end in a browser against a backend.
Nothing is marked Live.

| Admin capability | Backend (CMS lineage) | Hub client contract | Appears on public site after publish | Live E2E | Notes |
|---|---|---|---|---|---|
| Edit page text (save draft) | DB pass | Argument keys match | Not tested | No | Drafts are invisible to anonymous visitors (DB pass). |
| Publish page | DB pass | Argument keys match | Not tested live (DB: public body updates) | No | Editor cannot publish (DB pass). |
| Rollback | DB pass | Argument keys match | DB: public body restored | No | |
| Settings and contact details | DB pass | Via settings kind | DB: published link reaches public view | No | |
| Navigation | DB pass via settings and content | Via content kind | Not tested | No | |
| Blog posts (draft, publish, unpublish) | DB pass | Argument keys match | DB: published post visible, draft hidden | No | |
| Events (public event, featured) | DB pass | Argument keys match | DB: listed in public events view | No | Meeting-targeted events cannot be published (DB pass). |
| Images and media (upload, alt text) | DB pass | `web_register_media` match | Not tested | No | Storage buckets missing on this branch. |
| Media replacement and removal | Orphan detection only | Not checked | Not tested | No | Explicit removal path not verified. |
| Inquiries inbox (receive, review, status) | DB pass | Argument keys match | Not applicable | No | Submission through the edge function is covered by a Deno test not run here. |
| Role management (create, assign, revoke, permissions) | Functions exist under other names | **Mismatch** | Not applicable | No | Cannot succeed as written. |

## Other checks

- **Members cannot edit website content:** DB pass (analyst, editor, contributor and anonymous denied on drafts,
  publish, media and inquiries).
- **Unpublished content inaccessible to the public:** DB pass (anonymous reads of drafts, unpublished posts and
  unpublished events are denied or absent).
- **Hub authentication session and staff permissions preserved:** not verified live. The Hub's session code is
  unchanged by this work.

## What must happen before any of this can be verified live

1. Decide D5: how the CMS lineage (`107`-`116`) relates to this branch's `045`/`046`. Merging it changes the schema
   fingerprint and the migration inventory, so it is an owner decision, not a silent merge.
2. Align the five role RPCs. Either the client adapts to the backend's model (grant/unassign per permission, no
   versioning or archive) or the backend gains the functions the client expects. Both are owner decisions because the
   role model changes.
3. Provide an isolated Supabase project for the Preview (never the protected production project) and set
   `EXPECTED_PREVIEW_SUPABASE_REF` to its ref. Then run the live matrix above.

## Not done here

- No merge of the CMS lineage. No change to the role contract. No production write, migration or deployment.
- No new CMS, database or auth system.
