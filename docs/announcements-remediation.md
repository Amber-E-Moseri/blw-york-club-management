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

Migration `043_announcements_author_scoped_manage.sql` replaces the single `FOR ALL` policy from migration 031 with one policy per command. It is additive: historical migrations are not edited.

| Caller | Create | View | Edit / delete |
|---|---|---|---|
| admin, coordinator (active) | yes, as themselves | all | any post |
| cell leader (active) | yes, as themselves | all | only posts where `author_id = auth.uid()` |
| member (active) | no | all | no |
| pending, rejected, inactive | no | no | no |

- **Insert** (`announcements_insert`) requires `author_id = auth.uid()`. The author is never taken from the client as a claim of identity: a post is attributed to the caller or refused.
- **Update** (`announcements_update`) checks the row before and after the change. A cell leader cannot hand one of their posts to someone else, and cannot take a post that is not theirs.
- **Delete** (`announcements_delete`) uses the same ownership test as update.
- **Read** (`announcements_read`) is unchanged. It requires an active profile through `is_active_member()`.
- Table grants (migration 024) are unchanged: `authenticated` has select, insert, update and delete, which RLS narrows; `anon` has none.

**UI.** The page follows the same rules, per row. The composer shows for an active admin, coordinator or cell leader. Edit and Delete show on a post only when the signed-in user may change it. A pending, rejected or inactive account does not reach the list; the app holds it at a gate, and the database refuses its writes regardless.

**Not changed, flagged for follow-up.** Migration 043 does not stop an admin from reassigning an author. That is intentional under the admin hierarchy.

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
- **Database (real PostgreSQL RLS).** `supabase/verification/announcements_rls_certification.sql` runs the real policies under `SET ROLE` for each role, inside a transaction that is rolled back. It covers admin, coordinator, active cell leader on their own and another's posts, member, and pending, rejected and inactive accounts, for view, create, edit, reassignment and delete. It was run against a throwaway PostgreSQL 18 database with migrations 001–043 applied. Mutation checks with the old `FOR ALL` policy fail the script. It has not been run against a Supabase project.
- **Golden schema fingerprint.** `supabase/verification/schema_fingerprint.golden.json` records `announcements_manage`. That policy no longer exists after migration 043. The golden file is the authoritative hosted-schema record and is not edited in this PR. It must be regenerated from the certification project after this migration is applied there, and the hosted fingerprint check will fail until then.
