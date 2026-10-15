# Website Edge Functions (Phase D2)

Status: written and unit-tested locally. **Not deployed, and not exercised against a live Supabase stack.** Live testing
is the gate before Phase D2 can be called production-ready (see the report that accompanies this change).

## Functions

| Function | Who calls it | `verify_jwt` | Purpose |
| --- | --- | --- | --- |
| `website-inquiry` | Anonymous visitors (contact, New Here, prayer) | **false** | Turnstile check, per-client limit, then the database accepts or refuses the message |
| `website-rhapsody-pdf` | Anonymous readers | **false** | Resolves a published edition, records the download, redirects to a 120-second signed URL |
| `website-media-upload` | Signed-in staff with `website.media.upload` | true (default) | Checks the user's permission, issues a short-lived signed upload URL for a generated path |

Deploy the two public functions with JWT verification off, for example `supabase functions deploy website-inquiry --no-verify-jwt`.
Keep `website-media-upload` on the default (verified).

## Secrets (set per project, never in the repository)

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: provided to functions by the platform; the service-role key is used only inside these functions.
- `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile secret (required by `website-inquiry`).
- `CLIENT_HASH_SECRET`: at least 32 random characters. Keys the per-client and per-visitor hashes. Rotating it resets the per-client counters.
- `WEBSITE_ALLOWED_ORIGINS`: comma-separated https origins of the public site and admin app, for CORS.

## Browser configuration (Vite build variables)

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: public content and anon-key RPCs.
- `VITE_TURNSTILE_SITE_KEY`: when set, public forms **must** go through `website-inquiry`. Without it, forms use the direct RPC path, which has no per-client protection. Production must set this.

## Database

Migration `109_web_edge_support.sql` adds the per-client limiter (service role only), the upload permission check
(authenticated only) and the PDF path resolver (service role only). No storage policy grants anonymous or signed-in
users direct object access.

## Cleanup (scheduled)

`website-media-cleanup` deletes uploads that were never registered and that no website content mentions, older than 24
hours. It runs only with the service-role key as the bearer token and deletes only what `web_orphaned_uploads` returns.
Invoke it from a scheduler (for example a daily Supabase cron job). Deploy with `--no-verify-jwt`; the explicit bearer
check does the authorisation.

## Validation

Request bodies are validated with Zod (`zod@3.23.8`, pinned). Deno resolves `zod` through `supabase/functions/import_map.json`.
