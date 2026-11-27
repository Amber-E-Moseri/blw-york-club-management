# Database reconciliation, Phase A: evidence gap analysis

Scope: read-only comparison of the two hosted evidence files against the unified golden fingerprint
(`supabase/verification/schema_fingerprint.golden.json`, migrations 000-059). No database was written. No migration was
applied. The Preview and Production ledgers are not changed here.

Inputs (local, not committed): `blwyork-preview-evidence.json`, `blwyork-production-evidence.json`.

Repository state at the start of Phase A: HEAD `339040b` equals `origin/remediation/blw-york-wave1-5`. Working tree clean.
The second worktree (`BLW-York-Hub-hotfix`, `hotfix/p0-login-null-response` at `25e9673`) is clean and was not touched.

## Public relations (tables and views)

| Set | Count | Note |
|---|---|---|
| Preview evidence | 76 | Includes the 24 Preview-only tables, which are approved and must be preserved |
| Production evidence | 55 | |
| Unified golden | 64 | |

- Golden, missing in Production (12): `web_audit_log`, `web_client_rate_limits`, `web_content`, `web_download_events`,
  `web_event_publications`, `web_inbound_submissions`, `web_media`, `web_permission_catalogue`, `web_posts`,
  `web_rate_limits`, `web_rhapsody_editions`, `web_versions`. The same 12 are missing in Preview.
- Preview-only relative to golden (24): the 22 tables below are missing in Production, and `fellowships` and `member_directory` are present in both hosted databases.
  Missing in Production (22): `assignments`, `audience_publications`, `audience_snapshots`, `audience_specs`, `bsc_assignment_audit`,
  `cell_admin_audit`, `communication_audit`, `communication_deliveries`, `communication_messages`, `communication_recipients`,
  `contact_attribution_audit`, `identity_claims`, `identity_read_audit`, `identity_review_audit`, `leadership_release_audit`,
  `member_cell_audit`, `member_status_audit`, `person_identity_audit`, `profile_approval_audit`, `profile_link_audit`,
  `saved_group_members`, `saved_groups`.
- Production, not in golden: `contacts_bsc_view`, `fellowships`, `member_directory`.

## Functions (non-`pg_catalog`)

| Set | Count |
|---|---|
| Preview evidence | 142 |
| Production evidence | 63 |
| Unified golden | 84 |

- Golden functions missing in Production: 52. This includes every `_web_*` helper and the `web_*` RPCs introduced by
  migrations 047-059, for example `web_assign_website_role` and `web_authorize_edition`.
- Production functions not in golden: 31, mostly storage and auth platform functions. These are expected platform
  objects and need no action.

## Triggers

| Set | Count |
|---|---|
| Preview evidence | 95 |
| Production evidence | 40 |

## What this establishes

1. Neither hosted database matches the unified golden. The golden is the reviewed candidate shape, not a live copy.
2. Preview and Production also differ from each other: 22 Preview-only tables and their functions are absent in
   Production.
3. The owner decision stands: all 24 Preview-only tables and the approved feature set are preserved. Nothing here drops
   or renames them.

## What Phase B needs before it can be written

Phase B is a forward-only reconciliation. It cannot be written safely from these files alone:

- **DDL source for the Preview-only features.** The evidence has columns, constraints, policies, triggers and function
  summaries, but no migration source. These objects are not in `supabase/migrations/` (000-059). Their full definitions,
  including function bodies (the evidence has only `body_md5`), have to come from an authoritative source.
- **Production drift explanation.** Both ledgers record 000-099 with matching names and statement hashes, yet the schemas
  differ. The cause (manual change, a missing statement, or a different statement body behind a matching hash) must be
  known before a forward migration is designed against Production.
- **Phase definitions.** The phase names A, B and C are not defined in this repository. Phase A here is the evidence
  comparison above. Phases B and C need their scope confirmed before any migration is written.

No hosted migration, ledger change, reset or deployment was made.

Open release blocker, unaffected by this analysis: the desktop WebKit service-worker stall (see
`docs/production-readiness.md` section 0a). It requires resolution or an explicit approved disposition before release.
