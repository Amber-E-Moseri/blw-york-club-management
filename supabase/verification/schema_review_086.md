# Schema review: migrations 000–086 (d093a0c)

Reviewed against the real replay of `supabase_db_blw086cert` (PostgreSQL 17.6, project `blw086cert`, 87 migrations).
Evidence: `fp-real-086.json` (output of `schema_fingerprint.sql`). Golden: `schema_fingerprint.golden.json`.

## Ten new tables

| Table | Migration | RLS | Effective privileges | Review |
|---|---|---|---|---|
| `audience_publications` | 075 | on | anon: none; authenticated: SELECT; service_role: DELETE,INSERT,SELECT,UPDATE | Read: staff only. service_role has full DML for Edge workers. Not one of the four 086 tables. |
| `audience_snapshots` | 075 | on | anon: none; authenticated: SELECT; service_role: DELETE,INSERT,SELECT,UPDATE | Read: staff, or the caller's own row while active. service_role has full DML so the Edge fan-out can write. Not one of the four 086 tables. |
| `cell_admin_audit` | 072 | on | anon: none; authenticated: SELECT; service_role: none | Staff read. Written only by audit_cell_admin_change. service_role none (086). |
| `communication_audit` | 069 | on | anon: none; authenticated: SELECT; service_role: DELETE,INSERT,SELECT,UPDATE | Read: staff only. OPEN ITEM: service_role has full DML on an audit table, the same risk migration 086 closed for the four audit tables. Not changed here. |
| `communication_deliveries` | 069 | on | anon: none; authenticated: SELECT; service_role: DELETE,INSERT,SELECT,UPDATE | Read: staff, sender, or own delivery while active. service_role full DML for Edge workers. |
| `communication_messages` | 069 | on | anon: none; authenticated: SELECT; service_role: DELETE,INSERT,SELECT,UPDATE | Read: staff, sender, or recipient. service_role full DML for Edge dispatch. |
| `communication_recipients` | 069 | on | anon: none; authenticated: SELECT; service_role: DELETE,INSERT,SELECT,UPDATE | Read: staff, sender, or own recipient row while active. service_role full DML. |
| `leadership_release_audit` | 077 | on | anon: none; authenticated: SELECT; service_role: none | Staff read. Written only by release_bsc_leadership_on_deactivation. service_role none (086). |
| `member_cell_audit` | 072 | on | anon: none; authenticated: SELECT; service_role: none | Staff read. Written only by audit_member_cell_change. service_role none (086). |
| `member_status_audit` | 080 | on | anon: none; authenticated: SELECT; service_role: none | Staff read. Written only by set_member_status. service_role none (086). |

## Forty-five unlisted functions

Security mode and EXECUTE grants are as read from the real replay. Each body was read or scanned against its migration (see the note for each).

| Function | Migration | Security | EXECUTE | Category | Review |
|---|---|---|---|---|---|
| `publish_meeting(uuid)` | 074 | definer | authenticated | rpc | Requires is_meeting_manager. Invite-only meetings need at least one invitee. |
| `can_view_meeting(uuid)` | 074 | definer | authenticated | predicate | Active member plus manager, published visibility rule, or participant. |
| `guard_cell_lifecycle()` | 072 | invoker | none | trigger | Blocks deleting a cell with members or classes, and archiving a cell that still has them. Reads profiles and bscs under the caller's RLS, so it relies on staff seeing every row (checked in authenticated tests). |
| `is_message_sender(uuid)` | 069 | definer | service_role, authenticated | predicate | True only for the caller's own message. Service role gets false (auth.uid() is null). |
| `mark_message_read(uuid)` | 069 | definer | authenticated | rpc | Updates only the caller's own recipient rows, and only while active. |
| `is_meeting_creator(uuid)` | 074 | definer | authenticated | predicate | Active member and the caller created the meeting. |
| `is_meeting_manager(uuid)` | 074 | definer | authenticated | predicate | Active admin or coordinator, the cell leader of the meeting's cell, or the cell-leader creator. |
| `audit_cell_admin_change()` | 072 | definer | none | trigger | Writes cell_admin_audit on every cell change. |
| `snapshot_event_audience()` | 075 | definer | none | trigger | Snapshots the recipients of an event at insert. |
| `audit_member_cell_change()` | 072 | definer | none | trigger | Writes member_cell_audit on every cell_id change. |
| `is_message_recipient(uuid)` | 069 | definer | service_role, authenticated | predicate | Active member and the caller's own recipient row. |
| `resolve_audience_all(uuid)` | 082 | definer | none | owner | Unfiltered recipient resolver. Owner-only; the caller-scoped resolve_audience wraps it. |
| `claim_deliveries(uuid,text)` | 069 | definer | service_role | service | Edge worker claims delivery rows. Service role only. |
| `meeting_audience_spec(uuid)` | 082 | definer | authenticated | predicate | Returns the spec only after is_meeting_manager. |
| `is_meeting_participant(uuid)` | 074 | definer | authenticated | predicate | Active member with the caller's own attendance row. |
| `audience_specs_block_change()` | 073 | invoker | none | trigger | Raises on any UPDATE or DELETE of an audience spec (specs are immutable). |
| `guard_member_cell_placement()` | 072 | invoker | none | trigger | Requires active members and a non-archived cell for placement. Reads cells under the caller's RLS; staff see archived_at. |
| `meeting_attendance_normalise()` | 074 | invoker | none | trigger | Normalises attendance rows and checks auth.uid(). |
| `create_saved_group(text,uuid[])` | 079 | invoker | authenticated | rpc | Admin or coordinator only. Every member must be an active profile. Insert goes through table RLS. |
| `snapshot_affirmation_audience()` | 075 | definer | none | trigger | Snapshots the recipients of an affirmation at insert. |
| `transfer_member_cell(uuid,uuid)` | 072 | definer | authenticated | rpc | Admin or coordinator only. Refuses inactive members, BSC members, and cell leaders. |
| `audience_caller_can_target(uuid)` | 075 | definer | service_role, authenticated | predicate | Active admin or coordinator, or a leader targeting one led cell with no exclusions. |
| `block_targeted_audience_change()` | 075 | invoker | none | trigger | Blocks changing the audience of published content. |
| `is_audience_recipient(text,uuid)` | 075 | definer | service_role, authenticated | predicate | Active member with the caller's own snapshot row. |
| `snapshot_announcement_audience()` | 075 | definer | none | trigger | Snapshots the recipients of an announcement at insert. |
| `expire_stuck_deliveries(interval)` | 069 | definer | service_role | service | Edge worker expires stuck deliveries. Service role only. |
| `meeting_attendance_guard_delete()` | 074 | invoker | none | trigger | Refuses to delete recorded attendance. The row must be marked excused instead. |
| `set_member_status(uuid,text,text)` | 083 | definer | authenticated | rpc | Admin or coordinator only. Transitions are limited. Staff accounts are protected. Every change is audited. |
| `assignments_guard_assignee_changes()` | 084 | invoker | none | trigger | Only coordinators and admins may change task details or review (084 trusted-role guard). |
| `saved_group_members_require_active()` | 085 | definer | none | trigger | Every insert into saved_group_members requires an active profile (migration 085). |
| `audience_content_recipients(text,uuid)` | 075 | definer | service_role | service | Edge fan-out: active recipients of a publication. Service role only. |
| `meeting_roster_allowed(uuid,uuid,uuid)` | 074 | definer | authenticated | predicate | Manager, meeting-spec match, and the profile is in the resolved audience. |
| `release_bsc_leadership_on_deactivation()` | 077 | definer | none | trigger | Clears BSC leadership on deactivation and writes leadership_release_audit. |
| `respond_to_meeting_invitation(uuid,text)` | 074 | definer | authenticated | rpc | Active member who can view the meeting. Writes only the caller's own attendance row. |
| `audience_snapshot_content(text,uuid,uuid)` | 075 | definer | none | owner | Builds snapshot content. Owner-only; checks auth.uid(). |
| `release_cell_leadership_on_deactivation()` | 072 | definer | none | trigger | On profile deactivation, clears cell leadership. Writes cells. |
| `preview_audience(text,uuid[],uuid[],uuid[])` | 082 | definer | authenticated | rpc | Runs assert_can_send_message first, then returns names for the caller's permitted audience. |
| `create_assignments(text,text,date,text,uuid[])` | 076 | invoker | authenticated | rpc | Inserts under assignments RLS and the 081/084 assignee guard. The live authenticated tests must confirm a member cannot assign. |
| `assert_can_send_message(text,uuid[],uuid[],uuid[])` | 071 | definer | service_role, authenticated | predicate | Active account. Admin or coordinator may address any audience. A leader may address only cells they lead, in cells mode. |
| `set_meeting_audience(uuid,text,uuid[],uuid[],uuid[],boolean)` | 074 | definer | authenticated | rpc | Wrapper that delegates to set_meeting_audience_apply, which applies the manager gate. |
| `send_message(text,text,text,uuid[],uuid[],uuid[],text[],uuid)` | 069 | definer | authenticated | rpc | Runs assert_can_send_message first, then writes spec, message, recipients, deliveries and audit. |
| `set_meeting_audience_apply(uuid,text,uuid[],uuid[],uuid[],boolean)` | 074 | definer | none | owner | Applies a meeting audience. Owner-only; requires is_meeting_manager and enforces scope. Called from set_meeting_audience. |
| `create_audience_spec(text,uuid[],uuid[],uuid[],uuid[],uuid[],uuid[])` | 075 | definer | authenticated | rpc | Staff, or a leader with one led cell and no exclusions. Refuses an audience that resolves to nobody. |
| `audience_resolve_fields(text,uuid[],uuid[],uuid[],uuid[],uuid[],uuid[])` | 082 | definer | none | owner | Resolves recipient fields for previews. Owner-only; called from preview_audience after its guard. |
| `create_targeted_affirmation(text,text,date,text,uuid[],uuid[],uuid[],uuid[],uuid[],uuid[])` | 076 | invoker | authenticated | rpc | Admin or coordinator only. Insert goes through confessions RLS. |

Category legend: **trigger**: Trigger only. No API EXECUTE. **owner**: Owner-only helper. No API EXECUTE; called from owner-run definer code. **service**: Service-role only (Edge workers). **predicate**: Caller-scoped predicate (auth.uid()). Authenticated EXECUTE. **rpc**: Authenticated RPC. Caller authorised in the body.

## Open items (not changed by this review)

1. `communication_audit`: service_role holds full DML on an audit table. Migration 086 closed the same risk for four tables. Decide whether to extend 086.
2. `audience_specs_insert` policy: the policy still exists for `authenticated`, but the INSERT privilege was removed, so it is dormant. Remove it in a future migration, or keep it documented.
3. `schema_fingerprint.sql` records policy expressions but not the permissive or restrictive flag. `meetings_publication_gate` depends on being `AS RESTRICTIVE` (migration 074). A change to that flag would not be detected. Recommend adding it.
4. Invoker-mode guards and RPCs (`guard_cell_lifecycle`, `guard_member_cell_placement`, `create_saved_group`, `create_assignments`, `create_targeted_affirmation`) depend on table RLS. Authenticated live tests must confirm the outcome for each role.
5. Not yet re-verified because Docker was unresponsive: the exact version-by-version ledger comparison. The count (87) and min/max (000/086) were verified earlier.
