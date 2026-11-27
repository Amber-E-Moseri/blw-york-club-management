# Website administration: integration and verification

Scope: the existing Website Management in the Hub (`src/website`, `/admin/website/*`), the public website (`site/`), and
the shared Supabase database. One CMS, one database, one authentication system. Production HOLD.

## Migrations added (forward-only, after 046)

| File | Source (CMS lineage `feat/website-cms-integ-106`) | Change on the remediation lineage |
|---|---|---|
| `047_website_authorization.sql` | 107 | Uses the Hub's existing `admin_roles`, `admin_role_permissions`, `admin_role_assignments`. No second role system. |
| `048_web_content.sql` | 108 | Unchanged. Pages, settings, navigation: drafts, publication, versions, rollback. |
| `049_web_blog_events.sql` | 109 | Adapted: the remediation events table has `audience` ('all' or 'meeting') and no `audience_spec_id`. Only open, untargeted events can be public. |
| `050_web_inquiries_media.sql` | 110 | Unchanged. Inquiries, media register, buckets `site-media` (public images) and `rhapsody-pdfs` (private PDF). |
| `051_web_rhapsody.sql` | 111 | Unchanged. |
| `052_web_edge_support.sql` | 112 | Unchanged. Service-role functions for the intake and download edge functions. |
| `053_web_media_verification.sql` | 113 | Unchanged except the pinned search path (`public, pg_temp`). |
| `054_web_cleanup_revalidation.sql` | 114 | Unchanged except the pinned search path. |
| `055_web_security_remediation.sql` | 115 | Adapted: removed the `audience_spec_id` references (the column is not in this schema). |
| `056_web_unpublish_content.sql` | 116 | Unchanged. |
| `057_web_retire_role.sql` | new | `web_retire_website_role`: retires an unused, non-built-in role. Refuses while anyone holds it. Audited. |

No earlier migration was edited, renumbered or removed. The CMS branch's other history (its 000–106 lineage) was not imported.

Test harness change (not a migration): the PGlite storage shim now includes Supabase's `storage.objects` timestamp columns.

## Frontend contract (Hub and public site, kept identical)

The client called five role RPCs that did not exist. It now calls the backend's RPCs, and the role screens are adapted:

| Client method | RPC |
|---|---|
| `listRoles` | `web_list_website_roles` |
| `listAssignments` | `web_list_website_assignments` |
| `createRole(name, description, permissions, reason)` | `web_create_website_role` |
| `setRolePermissions(roleId, desired, current, reason)` | `web_set_website_permission`, one call per changed key |
| `retireRole` | `web_retire_website_role` (new) |
| `assignRole` | `web_assign_website_role` |
| `revokeAssignment` | `web_unassign_website_role` |

UI rules: a role needs at least one permission (the list shows only roles that hold a website permission, so a
permissionless role would be unreachable). Every role change needs a reason of at least 5 characters, which the audit
log records. Retirement is refused while anyone holds the role.

## Database verification

| Suite | Command | Result |
|---|---|---|
| CMS authorization (the 216 tests from the CMS lineage, unchanged, on the combined chain 000–057) | `npm run test:db:website` | 216/216 |
| Website role lifecycle (new): create, reason, non-core refusal, grant, unknown key, escalation, assign, self-assign, pending account, effective permissions, held-role retirement, revoke, retire, built-in protection, audit | `npm run test:db:website` | 26/26 |
| Remediation authorization (Wave 1) | `npm run test:db:authz` | 19/19 |
| Attendance authority (046 retained; only the approved forward migrations may follow it) | `supabase/verification/attendance_schema_pglite.mjs` | 9/9 |
| Membership reconciliation | `supabase/verification/membership_reconciliation_pglite.mjs` | 7/7 |
| Schema contract against the full chain (PGlite fingerprint) | `npm run test:db:contract` | 29/29 |

The 216 CMS tests cover public reads, published versus draft visibility, administrator and staff permissions, cross-role
denial, revocation, media rules, inquiry privacy, audit integrity, and Hub authorization. Each area has positive and
negative controls.

PGlite is an in-process PostgreSQL. It is not PostgreSQL 17, and the Supabase platform (GoTrue, PostgREST, storage
service) is shimmed. These results do not replace the PostgreSQL 17 certification.

## Schema contract and golden fingerprint

`schema_contract.json` now describes the new objects, reviewed from the migrations and the observed grants:

- Tables: the 12 `web_*` tables. Owner-only. No service-role access (they are reached only through definer functions).
- Authenticated: SELECT only on `web_audit_log` (core administrators, by RLS) and `web_permission_catalogue`.
- Views: the four `v_public_*` views. They are the only views anonymous visitors may read (published rows only, with
  `security_barrier`). The contract rule is now an explicit allowlist, not a blanket "no anon view" rule.
- Functions: every `web_*` and `_web_*` function, with its security mode and EXECUTE roles. Anonymous visitors and PUBLIC
  execute none. Service-role execute is limited to the intake, download logging and storage housekeeping functions.
- Storage buckets: `site-media` and `rhapsody-pdfs`, with their size and MIME limits.

`check_schema_contract.mjs` passes 29/29 on the full chain. The committed PostgreSQL 17 golden (`schema_fingerprint.golden.json`)
still describes 000–046 and must be regenerated on PostgreSQL 17. This cannot be done here (no Docker, and PGlite reports
NOT NULL constraints differently from PostgreSQL 17). It is done by the manual workflow `update-golden-fingerprint.yml`,
which now expects 58 migrations ending at 057. The workflow uploads a candidate for review, and the golden is committed
after review.

## Storage

- `site-media`: public, images only, 5 MB, JPEG/PNG/WebP. Registration requires alt text. Public access is via the
  published views only.
- `rhapsody-pdfs`: private, PDF only, 25 MB. Read through the edition functions only.
- Orphan detection (`web_orphaned_uploads`) and removal of unreferenced uploads (`web_upload_still_unreferenced`) are
  service-role only. Media that a page or post still references is never removed.

## Environment

`scripts/check-supabase-config.mjs` runs before every unified build. It fails when the public site (`VITE_SUPABASE_URL`)
and the Hub (`REACT_APP_SUPABASE_URL`) name different projects or keys, when a Preview points at the protected production
project `rjtstjmtddqhesexltbj`, when `EXPECTED_PREVIEW_SUPABASE_REF` is set and not matched, and when demo content is enabled
in production. Preview ref `yziuhtxtznginhdpqurb` is named in `.env.example` only as a placeholder. No service-role key
appears in any frontend code.

## Live end-to-end acceptance (not run)

The acceptance steps (sign in, edit and publish the homepage, upload and replace an image, create and publish an
event, submit an inquiry and see it in the inbox, confirm that an ordinary member cannot edit, assign and revoke a role)
need an authorised isolated Supabase project and test accounts. None is available in this session, so they are
**not run**. The database-level equivalents above pass.

## Not done here

- No merge of the CMS lineage. No production write, migration or deployment. No new CMS, database or auth system.
- The PostgreSQL 17 golden fingerprint, the hosted storage certification, and the live acceptance run.
