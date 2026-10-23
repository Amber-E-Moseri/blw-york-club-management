# Announcements remediation notes

This note records what the Announcements remediation changed, and the decisions it leaves for maintainers.

## What changed

- **Edit.** Managers can edit an announcement's title and message. The form is prefilled. Only `title` and `body` are sent, scoped to the one `id`, so the author and date never change. Editing does not send a push notification, and the page says so.
- **Delete.** Managers can delete one announcement after confirming in a dialog. The list refreshes after success. A refusal (RLS, or the row is already gone) shows an error in the dialog and keeps it open.
- **Refusals are errors.** Row Level Security filters an update or delete silently: a refused write returns no rows and no error. `updateAnnouncement` and `deleteAnnouncement` treat an empty result as a failure, so the UI never reports a save or delete that did not happen.
- **Empty and failed-load states.** An empty list shows a message. A failed load shows an alert with a working Retry. A failed "Load more" keeps the rows already shown and offers Retry.
- **Unread dot removed.** Nothing in the system records what a member has read, so the dot was always wrong. The `is_read` field was removed from the `Announcement` type.
- **Pagination.** The 20-row limit no longer hides older posts. "Load more" fetches the next 20. Ordering is `created_at desc, id desc`, and the next page starts strictly after the last row shown, so rows added while reading do not shift the page. Duplicate ids are dropped when pages are merged.

## Authorization

- **UI.** Edit and Delete appear for `admin`, `coordinator` and `cell_leader`, the same roles as `canManageAnnouncements`.
- **Database.** Enforcement is by the existing policy `announcements_manage` (migration 031). It allows `is_admin_or_coordinator()` or an active cell leader. `is_admin_or_coordinator()` reads `current_user_role()`, which requires `status = 'active'`. Table grants (migration 024) give `authenticated` select, insert, update and delete, and give `anon` nothing. No migration was added.
- **Decision for maintainers.** Under the current policy, any active cell leader can edit or delete any announcement, not only their own. Limiting that to the author or staff would need a new migration and a policy change. This PR does not make that change.

## Audience

- Announcements are organisation-wide today. The `announcements` table has no audience column. Anyone who is an active member can read them (`announcements_read` = `is_active_member()`), and "Send a push notification" goes to every active member with an active push subscription.
- **Discrepancy.** `src/lib/audience/audienceContract.ts` says that announcements "use the same audience_specs rows through their own RPCs". No such RPC or link exists for announcements in the schema or the code. This is a separate decision: keep announcements organisation-wide and correct the contract comment, or build audience targeting in its own change. This PR does not add targeting.

## Read state

- No persistent read tracking exists (no table, no column). This PR does not add one.
- The dashboard statistic `unread_announcements` is still hard-coded to `0` in `src/lib/queries.ts` and `src/lib/queries/dashboardStats.ts`. It is outside this PR's scope and is a separate follow-up.

## Not changed

- Creating an announcement, the push-notification call (`notify-announcement`), and its once-only guard.
- Personal Messages and Personal Notes on `/messages`.
- The notification and email code.

## Verification

- **Unit (Jest).** `announcementRules.test.ts` covers role gating, list isolation, de-duplication and a simulated keyset pagination. `announcementQueries.test.ts` covers the exact filters and column lists sent, and treats an empty write result as a refusal.
- **Browser (Playwright, mock backend).** `e2e/announcements.spec.ts` runs each case at desktop (1280×800) and phone (375×812) widths: empty and failed-load states, Retry, edit, delete (confirm, keep, refusal), Load more with no gaps or duplicates, and the no-horizontal-scroll check. The mock backend lives in the spec and does not prove database behaviour.
- **Database (real PostgreSQL RLS).** `supabase/verification/announcements_rls_certification.sql` runs the real policies under `SET ROLE` for each role, inside a transaction that is rolled back. It was run against a throwaway PostgreSQL 18 database with migrations 001–031 applied. It has not been run against a Supabase project.
