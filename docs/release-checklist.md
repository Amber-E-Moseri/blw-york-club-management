# Release convergence checklist

Scope is frozen to the five approved milestones. Every item maps to one of them. Production HOLD until explicit owner approval.

Classification: P0 security/privacy/data loss/system failure; P1 material regression or release-blocking compatibility;
P2 non-blocking improvement; P3 future enhancement. P2 and P3 items go to the post-release backlog below, not into this release.

## Milestone 1 — Close material regressions

| # | Item | Acceptance criterion | Status |
|---|------|----------------------|--------|
| 1.1 | Privacy closure (070) and identity linking (073) do not break leader workflows | Database suites: cell_contacts 25/25, assignment_progress 41/41, contact_identity 15/15; Jest leader-view tests | Done |
| 1.2 | Announcement notification scope | announcement_dispatch 45/45; static dispatcher guard 4/4 | Done |
| 1.3 | Attendance trigger does not rewrite historical attended values | attendance_preservation 20/20 (includes the rolled-back control) | Done |
| 1.4 | Unified production build assembles | `npm run build:unified` exit 0 | Done |
| 1.5 | Route verification | `scripts/verify-unified-routes.mjs`: 69 pass, 0 fail | Done |
| 1.6 | Golden fingerprint matches the checkpoint (contract test green) | Golden run for the checkpoint completes; artifact digest recorded; contract test 18/18 | Pending (run for b458a5c queued at time of writing) |

## Milestone 2 — Reconciliation of originally approved functionality

| # | Item | Classification | Status |
|---|------|----------------|--------|
| 2.1 | Leadership authority derived from `cells.leader_id` | P1 (approved) | Done |
| 2.2 | Member contacts for leaders (scoped directory, approved contact fields only) | P1 (approved) | Done |
| 2.3 | Prayer confidentiality (anonymous authors never exposed) | P0 | Done |
| 2.4 | Announcement dispatch scope and lifecycle | P0/P1 | Done |
| 2.5 | Follow-up assignment and reassignment by member key | P1 (approved) | Done |
| 2.6 | Reading progress by member key (dates only) | P1 (approved) | Done |
| 2.7 | Five-state attendance preserved; legacy values not reclassified | P0 (data) | Done for preservation. Member confirm and excuse via RPC is preserved. Staff verification workflow relies on existing RPCs and is covered by existing suites |
| 2.8 | Contact identity: no existence oracle, no client-chosen person | P0 | Done |
| 2.9 | Audience and saved-group access and recipient resolution as currently approved | P1 | Existing suites: audience 18/18, bsc_scoped 16/16. Not re-audited (no new evidence) |
| 2.10 | Audience snapshots (historical copies) | P2 unless the owner confirms it is an approved release feature | Backlog |
| 2.11 | Targeted communications beyond the existing send paths | P2 unless confirmed approved | Backlog |
| 2.12 | Membership authority, duplicate reporting, privacy directory, administrative reconciliation | P2 unless confirmed approved | Backlog |
| 2.13 | CMS and Edge Function compatibility | P1 if any approved function fails; verified by existing website_cms_authz 216/216 and website_roles 35/35 | Done for database; Edge functions not executed here |

## Milestone 3 — Hosted Preview and Production upgrade paths

| # | Item | Acceptance criterion | Status |
|---|------|----------------------|--------|
| 3.1 | Candidate chain separated from hosted ledgers | `docs/hosted-migration-strategy.md` | Done |
| 3.2 | Preview upgrade path against existing ledger and evidence | Owner-supplied ledger and catalog evidence reviewed against candidate 060–073 | Pending owner-supplied review |
| 3.3 | Production upgrade path | Same, plus backup and explicit approval | Pending; HOLD |

## Milestone 4 — Release certification

| # | Item | Acceptance criterion | Status |
|---|------|----------------------|--------|
| 4.1 | Desktop Chromium smoke (public site, Hub login) | No page errors, no horizontal scroll | Done (local build) |
| 4.2 | Mobile Chromium smoke (375px) | Same | Done (local build) |
| 4.3 | Desktop WebKit | Renders and logs in without the service-worker stall | BLOCKER: WebKit not installed in this environment; owner-classified release blocker |
| 4.4 | Mobile WebKit | As 4.3 | BLOCKER (same) |
| 4.5 | Authenticated workflows: Members, Cells, Assignments, ROR, Announcements, Attendance | Run against a Preview backend with a test account | BLOCKER for Preview acceptance (no authenticated backend here) |
| 4.6 | Three-path certification (fresh install, Preview, Production starting states) | Evidence per path | Pending |

## Milestone 5 — Controlled production release

Requires explicit owner approval after 1 to 4 are closed. No production deployment is authorised by this document.

## Genuine release blockers (as of this writing)

1. Desktop WebKit (and mobile WebKit) verification: owner-classified blocker; engine unavailable here.
2. Authenticated workflow verification against a Preview backend (4.5).
3. Hosted Preview and Production upgrade review (3.2, 3.3).
4. Golden artifact for the final checkpoint (1.6).

## Post-release backlog (P2 and P3, not implemented)

- Announcement audience picker copy and cell-level dispatch reporting in the Hub UI (P2).
- Leader ROR per-person calendar restyle; cell-level attendance-rate field remains "unavailable" (P2).
- Prayer dashboard count for staff restyle (P2).
- Audience snapshots, targeted communications, membership authority, duplicate reporting, privacy directory, administrative reconciliation (P2 unless confirmed; see 2.10 to 2.12).
- Full multi-leader cell assignment UX (P3).
