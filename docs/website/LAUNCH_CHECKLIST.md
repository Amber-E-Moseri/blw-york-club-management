# Website launch checklist

Status of this document: preparation only. Nothing here has been deployed, configured in production, or verified against
a real Google account. Items marked **NOT VERIFIED** must not be reported as done until the stated test passes.

Release candidate under preparation: `rc/website-d2` at `ec17d2218efa4e0830d99b41c75520e85cfad285`, technically certified
by GitHub Actions run 38847896553 (live certification 87/87, Turnstile rejection 6/6). This launch branch adds one
forward-only migration and the cleanup schedule, and must be certified again before use.

## 1. Google OAuth (NOT VERIFIED)

The Website Management sign-in uses Google only (AGENTS.md). Required setup, in an isolated test project first:

1. Google Cloud: create an OAuth 2.0 client (type "Web application"). Authorised redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback`. Use a test client for certification, a separate client for launch.
2. Supabase Dashboard > Authentication > Providers > Google: enable, paste the client ID and secret (owner only).
3. Supabase > Authentication > URL configuration: Site URL = the public site; add the admin callback to the redirect
   allow-list: `https://<public-site>/admin` (and the preview hostname only for testing).
4. The admin sign-in link is `…/auth/v1/authorize?provider=google&redirect_to=<admin URL>` (site/src/admin/session.ts).

Short real-account sign-in test (owner runs it; record the date and account label, never the address):

1. Prepare two real Google accounts: A (a test member approved as active, with one website role) and B (active, no role).
2. Open `/admin`, choose "Continue with Google", sign in as A. Expect the dashboard with only A's role's screens.
3. As A, attempt one permitted action (save a draft) and one forbidden action (publish, if A cannot publish). Expect success and a refusal.
4. Sign out. Sign in as B. Expect no content and no write access.
5. Check the audit log shows A's actions and B's refusal, with no personal data beyond the account identifier.
6. Result: PASS only if steps 2–5 behave as written. Otherwise record the step and the observed behaviour.

## 2. Production configuration checklist (no step below has been applied)

### Supabase (a new, isolated project for the website backend; see section 6)

- [ ] Apply migrations 000–111 in order. Never edit 000–103. Use the migration tool, not hand SQL.
- [ ] Auth: Google provider enabled; Site URL and redirect allow-list as in section 1.
- [ ] Storage: buckets `site-media` (public, 5 MB, images) and `rhapsody-pdfs` (private, 25 MB, PDF) come from migration 107.
- [ ] Edge Functions, deployed from the release commit:
  - `website-inquiry`: `--no-verify-jwt` (visitors are anonymous; checks are inside the function).
  - `website-rhapsody-pdf`: `--no-verify-jwt` (readers are anonymous; signed links are issued by the function).
  - `website-media-upload`: default verified JWT (staff only).
  - `website-media-cleanup`: `--no-verify-jwt` (the function requires the service-role bearer key itself).
- [ ] Function secrets (set in Supabase, never in the repository):
  - `TURNSTILE_SECRET_KEY`: the live Turnstile secret key.
  - `CLIENT_HASH_SECRET`: at least 32 random characters; keep it. Rotating it resets per-client counters.
  - `WEBSITE_ALLOWED_ORIGINS`: comma-separated https origins of the public site and the admin app.
  - `WEBSITE_PUBLIC_URL`: the project's public https address, for example `https://<ref>.supabase.co`. Signed upload and
    PDF links are returned on this address. It must not be the internal address the functions use.
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: provided by the platform. Do not copy the service key anywhere else.
- [ ] Database backups and point-in-time recovery enabled for the project (platform setting, owner).

### Turnstile

- [ ] Create a Turnstile widget for the public site hostname (owner, Cloudflare account). Allowed hostnames: the site only.
- [ ] Site key goes to Vercel as `VITE_TURNSTILE_SITE_KEY`. Secret goes to Supabase as `TURNSTILE_SECRET_KEY` (section above).
- [ ] Without the site key, public forms refuse to send (by design). Without the secret, the function refuses every message.
- [ ] Certification used Cloudflare's published test secrets. Live keys have not been tested.

### Vercel (public site)

- [ ] Project root `site`, framework Vite, build `npm run build`, output `dist`. `site/vercel.json` provides the SPA rewrite
      and the Content-Security-Policy and security headers.
- [ ] Environment variables (Production):
  - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = the project's anon key (public by design; never the service key)
  - `VITE_TURNSTILE_SITE_KEY` = the live Turnstile site key
  - `VITE_FOUNDATION_ENROLL_URL` = the approved enrolment link (https), or leave unset to hide enrolment buttons
- [ ] Do not set any `VITE_` variable that contains a secret. Vite embeds `VITE_` values in the public bundle.
- [ ] The CSP `connect-src` and `object-src` allow `https://*.supabase.co`. A custom API domain would need the CSP updated first.
- [ ] Production builds never show sample content. Without a configured backend they show "temporarily unavailable".

### WEBSITE_PUBLIC_URL and signed links

- Signed upload links (`website-media-upload`) and PDF redirects (`website-rhapsody-pdf`) are built on `WEBSITE_PUBLIC_URL`.
- The URL check accepts only https addresses without credentials, or loopback http for local testing.
- Misconfiguration fails closed: the function returns 503 and logs an event code with the origin only.

### Scheduled cleanup (once daily)

- [ ] Owner merges `website-media-cleanup.yml` to the default branch (not done; requires approval, see section 7).
- [ ] Create GitHub environment `website-cleanup` with required reviewers.
- [ ] Set environment variable `WEBSITE_SUPABASE_URL` and secret `WEBSITE_CLEANUP_SERVICE_KEY` (owner only).
- [ ] The workflow runs at 03:20 UTC. It does nothing until these steps are complete.
- Behaviour: objects must be at least 24 hours old, unregistered, and unmentioned in any content version or draft. Each object is
  checked again immediately before deletion (migration 111). Referenced assets are never deleted.

## 3. Unpublished content that needs approval before launch

Production shows published content only. Items below are either not yet published, or cannot be published by the current
mapping. Each must be approved, supplied, or removed.

| Area | Current state in production | Approval needed |
| --- | --- | --- |
| Home hero | Shows only when the `home` page is published. Heading and body come from it. | Approved wording |
| Home ministries block | Hidden (no published ministries). | Decide whether to publish ministries |
| About: mission and vision | Shown when the `about` page has text sections. | Approved wording |
| About: beliefs, ministries, leadership, opportunities | Hidden. No mapping exists from published rows. | Approved text, or remove |
| **Foundation School** | **BLOCKER.** When published, the page shows the published headline and intro, but the other sections (what it is, who it is for, learning points, journey, benefits, enrolment steps, FAQs) still come from the Phase C sample copy. | Approved copy and a mapping for every section, or the page stays unpublished |
| New Here: welcome points and questions | Shown when published. | Approved wording |
| New Here: what to expect | Hidden. No mapping exists. | Approved text, or remove |
| Events, blog, Rhapsody | Only published, real records. | Real content from editors |
| Contact details (email, address, service day and time, socials) | Blank until published in Settings. | Real values |
| Foundation School enrolment link | Hidden unless `VITE_FOUNDATION_ENROLL_URL` or the published link is set. | Approved https link |
| Logo, favicon, hero image | Text mark and no image until published. | Approved images and alt text |
| Footer policy line | Only in demo mode. | Privacy and terms pages, when drafted |

## 4. Accessibility and responsive status

- Automated accessibility checks (axe-core) pass on every public route, the production states and the media screen.
  Colour contrast was not measured by the automated check. It needs a browser check before launch. **NOT VERIFIED.**
- Responsive checks were run at 375 px and desktop width on the demo and production states only.

## 5. Isolation: can the website run without changing the Hub production database at frontier 037? (Assessment)

Short answer: **the public site can be deployed separately. The website backend cannot run on the Hub production database
without changing it, and cannot run on a separate database without a separate identity model.**

- Migrations 104–111 are not standalone. Migration 104 reads `public.profiles` (role and status), and the website
  permission helpers depend on `is_active_profile` (migration 036). They also depend on the Storage schema and
  the Auth schema. Applying them to the Hub production database at 037 would change production (new tables, functions,
  storage buckets and roles). That is forbidden without approval.
- A separate Supabase project is technically possible: replay the Hub baseline (000–103, no member data) and then 104–111 in
  an empty project. This leaves production untouched.
- A separate project has its own `profiles`. Website administrators would have to be created or invited there. Copying
  Hub members into that project would copy personal data, which needs its own approval.
- The public site itself reads only published views with the anon key. It can point at a separate project without
  touching the Hub.
- Verified here: the 000–111 replay on a fresh local database, and the live certification on a fresh local stack on a
  hosted runner. **Not verified:** a hosted separate project, Google sign-in, and live Turnstile.

## 6. Approvals still needed (the only items that block launch)

1. **Google OAuth test client and two real test accounts** (owner), for the section 1 test. Without this, OAuth is not verified.
2. **A new isolated Supabase project for the website backend** (owner). Creating it may be a paid resource; the cost must be
   approved first. Identity model to be decided: fresh administrators, or a reviewed copy of Hub staff accounts.
3. **Live Turnstile keys** (owner, Cloudflare account), and confirmation of allowed hostnames.
4. **Cleanup schedule:** approve merging `website-media-cleanup.yml` to the default branch, and creating the `website-cleanup`
   environment with the variable and secret above. Alternative: a Supabase scheduled job. Either needs approval.
5. **Content approval** for the items in section 3, including the Foundation School copy (blocker).
6. **Deployment:** approval to deploy the public site to Vercel, and to deploy the Edge Functions to the new project.
7. **Merge to `main`:** not requested and not performed.

## 7. Next action

Owner: approve items 2 and 1 first (they gate every other step). Then the Foundation School copy (item 5). The cleanup schedule
and the live Turnstile keys can follow. After approval, the next step is a re-certification of the launch commit on a test
branch, then the sign-in test in section 1.
