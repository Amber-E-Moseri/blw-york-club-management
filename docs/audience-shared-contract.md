# Shared Audience Contract (reconciled)

Status: **authoritative** for messages, meetings, events, announcements, assignments and affirmations.
Branch: `integration/blwyork-audience-reconcile`. Supersedes `docs/audience-infrastructure-contract.md` (Agent 5, commit `9b21d6a`), which is not carried forward.
Migration numbers in this document are **proposed**. Agent 6 confirms them before merge (see §10).

---

## 1. Decision

**One model: the operational `audience_specs` (migration 059), extended by 068 and 069. No second set of audience tables.**

| Question | Decision |
|---|---|
| Foundation | Keep migration 059 (`audience_specs`, `saved_groups`, `saved_group_members`, `resolve_audience`). The replay found no reason to replace it. |
| Caller scope and enumeration | Keep 066 (Agent 3). `resolve_audience()` returns only the caller's own row unless staff. `resolve_audience_all()` is internal. |
| Shape | Five modes: `all`, `cells`, `saved_groups`, `explicit`, and new `composite` (any union). Exclusion arrays on every mode. (068) |
| Overlap | Set semantics. One person appears once, whatever selected them. Snapshot primary keys enforce it. |
| Exclusions | `excluded_cell_ids`, `excluded_group_ids`, `excluded_profile_ids`. Exclusion always wins. Staff only. (068) |
| Frozen snapshots | Targeted announcements, affirmations and events take a snapshot at insert (`audience_publications` + `audience_snapshots`, 069). Messages keep Agent 3's `communication_recipients`, which is the same rule. |
| Live vs frozen | **Frozen for all targeted content.** The "live" option from Agent 5's UI is removed. Live resolution for published content caused the membership-change exposure found in testing. |
| Caller authorization | Staff: any audience. Cell leader: exactly one cell they lead, no exclusions, no broadcast. Enforced by `create_audience_spec()` and `audience_caller_can_target()` (069). |
| Membership changes | Snapshot is fixed at publish. A person who joins later cannot see earlier targeted content. A person who leaves keeps the access they were given. |
| Pending / rejected / inactive | Never recipients (`profiles.status = 'active'` in every resolver). A rejected or pending recipient loses visibility immediately (`is_active_member()` in every read policy). |
| Private content | Affirmation declarations stay private (052, plus the 069 declaration guard). Targeted events and announcements are visible only to snapshot recipients and staff. |
| Audit | `audience_publications` (one per targeted item: who published, spec, count) and `audience_snapshots` (who was a recipient). `communication_audit` for messages. Staff-only read. |

---

## 2. Tables

| Table | Owner | Notes |
|---|---|---|
| `saved_groups` | 059, 065 | Staff read and write. **No delete grant** (068). Archive with `is_active = false`. |
| `saved_group_members` | 059, 065 | Staff read and write (066). |
| `audience_specs` | 059, 068 | **Immutable** (trigger, 068). Created only by `create_audience_spec()` (069). Staff read. |
| `audience_publications` | 069 | One row per targeted item `(content_type, content_id)`. Staff read. |
| `audience_snapshots` | 069 | Recipients of a publication. Recipient reads own rows; staff reads all. |
| `communication_messages`, `communication_recipients`, `communication_deliveries`, `communication_audit` | 067 (Agent 3) | Message snapshot and delivery. Kept as-is. |

Consumers reference a spec with `audience_spec_id`, using `ON DELETE RESTRICT` (068). Before 068 this was `SET NULL`, which turned a deleted audience into a broadcast.

### Spec shape

```
audience_specs (
  id, mode in ('all','cells','saved_groups','explicit','composite'),
  cell_ids[], group_ids[], profile_ids[],                 -- includes (per mode)
  excluded_cell_ids[], excluded_group_ids[], excluded_profile_ids[],   -- exclusions (any mode, staff)
  created_by, created_at
)
```

Invariants (database-enforced): a mode names exactly the kinds it uses (`create_audience_spec`); `composite` has at least one include; a spec never changes.

---

## 3. Recipient resolution (one API)

| Function | Who may call | Returns |
|---|---|---|
| `resolve_audience(spec)` | any authenticated user | staff: all recipients. Others: at most their own row. |
| `resolve_audience_all(spec)` | nobody directly (internal, owner-only) | the full resolution used by the functions below |
| `create_audience_spec(mode, cells, groups, profiles, excl_cells, excl_groups, excl_profiles)` | active members within scope | a new spec id. Refuses a spec that resolves to nobody. |
| `audience_snapshot_content(type, id, spec)` | trigger only | freezes recipients, raises if empty |
| `audience_content_recipients(type, id)` | `service_role` only | frozen recipients of a targeted item (used by notifications) |
| `is_audience_recipient(type, id)` | authenticated | whether the caller is in the frozen snapshot |

Resolution rule (`resolve_audience_all`, the same in the TypeScript preview):

1. Include set by mode: `all` = every active profile; `cells` = active members of the cells; `saved_groups` = active members of **active** groups; `explicit` = named active profiles; `composite` = the union of the kinds.
2. Exclude set (any mode): members of excluded cells, excluded groups (regardless of their active flag), and excluded people.
3. Result = include − exclude, deduplicated, `status = 'active'`.
4. A spec that resolves to nobody is an error at creation, and an error at publish. It is never treated as "everyone".

### Error codes

| SQLSTATE | Cause |
|---|---|
| `42501` | not active; outside caller scope; not visible (same error for missing and invisible, so ids cannot be enumerated); immutable change; direct write attempt |
| `22023` | mode does not match its kinds; no include; unknown or archived group; unknown cell or person; empty audience at creation or publish |

---

## 4. Permission matrix (reconciled)

`✓` allowed · `scope` = own led cell only · `✗` denied

| Action | Admin / coordinator | Cell leader | Member / pending / rejected |
|---|---|---|---|
| Create spec, `all` | ✓ | ✗ | ✗ |
| Create spec, `cells` | ✓ | `scope` (one led cell, no exclusions) | ✗ |
| Create spec, `saved_groups` / `explicit` / `composite` | ✓ | ✗ | ✗ |
| Use exclusions | ✓ | ✗ | ✗ |
| Publish announcement, broadcast (no spec) | ✓ | ✗ | ✗ |
| Publish announcement, targeted | ✓ | `scope` (own cell) | ✗ |
| Publish affirmation | ✓ | ✗ | ✗ |
| Publish event (any audience) | ✓ | ✗ | ✗ |
| Send message | ✓ (any) | own cell only (Agent 3, 067) | ✗ |
| Read a targeted item | ✓ | author; or recipient | recipient only, and only while active |
| Read a spec, saved group or membership | ✓ | ✗ | ✗ |
| Read a snapshot (`audience_snapshots`) | ✓ | ✗ | own rows only |
| Update a spec, or a published item's audience | ✗ | ✗ | ✗ |
| Delete a spec or a saved group | ✗ | ✗ | ✗ |

Consumers keep their own write permission. Passing a spec to `create_audience_spec` does not make a caller allowed to publish.

---

## 5. Consumers

| Content | Audience | Membership model | Visibility | Notification |
|---|---|---|---|---|
| Announcement | spec, or NULL = broadcast (staff only) | frozen at insert | broadcast: active members. Targeted: snapshot + staff + author | n/a |
| Affirmation (`confessions`) | spec, or NULL = broadcast (staff only) | frozen at insert | broadcast: active members. Targeted: snapshot + staff | n/a |
| Affirmation declaration | — | — | declaration identity stays private (052). Insert requires the caller to see the affirmation (069) | n/a |
| Event | spec for targeted; `all` = broadcast; `meeting` = meeting attendance | frozen at insert for targeted | targeted: snapshot + staff. Broadcast and `meeting` events stay visible to active members, as before | `notify-event` routes by `_shared/audience-recipients.ts` |
| Message (`communication_*`) | spec via `send_message` (067) | frozen at send (`communication_recipients`) | sender, staff, recipient (own row) | dispatcher, per delivery row |
| Meeting invitation | `meeting_attendances` (061) | **live** (explicit list the leader edits until the meeting) | `explicit` meetings: invitees and staff | n/a |
| Assignment (`assignments`) | individual `assigned_to`; no broadcast | per row | assignee; staff; leader of the assignee's cell | n/a |

### Notification routing (fail closed)

`supabase/functions/_shared/audience-recipients.ts`:

- A spec, when present, **always governs**. It is never ignored.
- Spec-less `all` is the only broadcast. Spec-less `meeting` uses attendance.
- Anything else throws and sends nothing. The notify claim is released so an admin can fix and retry.

This replaces a branch that sent to every active member for any audience other than `meeting`. With migration 060, that branch would have push-notified the whole fellowship for an event targeted to cells.

---

## 6. Membership changes

| Change after publication | Effect on targeted content |
|---|---|
| Person added to a group or cell | **No access** to earlier content (snapshot) |
| Person removed from a group or cell | **Keeps access** they were given (snapshot). Documented; not widened or narrowed |
| Person becomes pending, rejected or inactive | **Loses access immediately** (`is_active_member()` in every read policy) |
| Group archived | Published content unchanged. New content cannot use the group (refused at create and publish) |
| Group deleted | Not possible for clients (grant revoked). Archive only |
| Spec referenced by content | Cannot be deleted (`RESTRICT`), cannot be updated (immutable trigger) |
| Published item's audience changed | Refused (trigger). Create new content instead |

---

## 7. Deletion and modification (no silent broadcast)

| Attempt | Result |
|---|---|
| Delete an audience spec referenced by content | Refused (immutable trigger, and `RESTRICT`) |
| Update an audience spec | Refused (immutable trigger; no client grant) |
| Set a published item's `audience_spec_id` to NULL | Refused (trigger). NULL would read as broadcast |
| Publish with a spec that resolves to nobody | Refused (`22023`). Nothing is saved |
| Publish with a spec that became empty after creation | Refused (`22023`) at publish |
| Publish with a targeted kind and no spec | `notify-event`: refused. The `events` check requires a spec for non-`all`/`meeting` audiences |
| Leader posts a broadcast (NULL spec) | Refused by RLS (`42501`). This was allowed before 069 |

**Residual, stated plainly:** a staff member who inserts an announcement or affirmation with a NULL spec publishes a broadcast on purpose. That is the only way to a broadcast, and it is staff-only. The UI sends an explicit "Everyone" choice; it never sends NULL by default.

---

## 8. Private content visibility

- **Targeted content** (announcements, affirmations, events): recipients in the snapshot, staff, and the author. Nobody else, including members with a matching cell or group after publication.
- **Affirmation declarations:** the declarer sees their own row; staff see counts and identities as before (052). The declaration insert requires `can_see_affirmation()`, which reads the snapshot.
- **Saved groups and memberships:** staff only (066). Members cannot enumerate who is in which group.
- **Specs:** staff only. Members cannot read another person's audience.
- **Recipient lists:** `audience_snapshots` for targeted content (own row for members, all for staff); `communication_recipients` for messages.

---

## 9. Audit

| Record | Written by | Read by |
|---|---|---|
| `audience_publications` (who published, which spec, how many) | `audience_snapshot_content()` (trigger) | staff |
| `audience_snapshots` (who was a recipient) | `audience_snapshot_content()` | staff; recipient (own row) |
| `communication_audit`, `communication_recipients`, `communication_deliveries` | `send_message()`, dispatcher (Agent 3) | per their policies |

Specs are immutable, so the spec that produced any snapshot can always be read by staff and cannot change under it.

---

## 10. Migration files and order

| File | Owner | Status |
|---|---|---|
| `059_shared_audience_infrastructure.sql` | ops | merged, unchanged |
| `060_events_audience_spec.sql` | ops | merged, unchanged |
| `061_meeting_explicit_invitee_read.sql` | ops | merged, unchanged |
| `062_assignments.sql` | ops | merged, unchanged |
| `063_affirmation_audience_targeting.sql` | ops | merged, unchanged |
| `064_announcements_audience_targeting.sql` | ops | merged, unchanged. Its leader broadcast path is removed by 069 |
| `065_audience_grants_and_policy_fixes.sql` | ops | merged. Edited in place by `acdac39` (see §11) |
| `066_audience_resolution_scope.sql` | Agent 3 (messaging) | merged, unchanged |
| `066_meeting_invitee_read_fix.sql` | ops (`9118787`) | merged. **Duplicate prefix with the line above. Blocker, §11** |
| `067_targeted_messages.sql` | Agent 3 (messaging) | merged, unchanged |
| **`068_audience_spec_canonical.sql`** | this reconciliation | **proposed** |
| **`069_audience_snapshots_and_visibility.sql`** | this reconciliation | **proposed**. Depends on 068 |

Order: 059 → 060 → … → 067 → 068 → 069. 068 depends on 066 (`resolve_audience_all`) and 067 (`send_message` uses specs). 069 depends on 068.

---

## 11. Blockers

1. **Duplicate migration prefix `066`.** `066_audience_resolution_scope.sql` (Agent 3) and `066_meeting_invitee_read_fix.sql` (ops). `supabase/migrations`-level tests fail on this (`migrationArchitecture.test.ts`: "unique numeric prefixes" and "contiguous"). Agent 6 renumbers one of them. The two are independent, so either order replays cleanly. This document does **not** pick the number.
2. **`065` edited in place** by `acdac39`. Forward-only means a migration that may already be applied is not changed. The fix belongs in a new forward migration. Behavior is the same on a fresh replay, but drifted databases will not match.
3. **Messaging certification (Agent 3) defects.** `messaging_certification.sql` cannot run as committed: `cert_pass`/`cert_fail` lack `SECURITY DEFINER`, so recording a result under the `authenticated` role is denied. One check also asserts the wrong thing: `member_b1` is a recipient of the message it checks, so seeing their own row is correct. With the `SECURITY DEFINER` fix in a scratch copy, 17 of 18 messaging checks pass. The eighteenth is the wrong assertion above (see `docs/audience-reconcile-certification.md`).
4. **Schema golden not regenerated.** See the certification report.
5. **Pre-existing `tsc` errors** in `src/__tests__/operationalWorkstreams.test.ts` (`matchAll` iteration with the project's ES5 target). Present on the ops branch before this work.

---

## 12. Adopted from Agent 5 / rejected / deferred

### Adopted (adapted to the canonical model)

| Feature | How it lands |
|---|---|
| `AudienceSelector` component | Rewritten to edit the canonical `AudienceSpecDraft` (`src/components/feature/AudienceSelector.tsx`). Chips show include and exclude. Live preview. Empty-audience validation. Clear selection. Responsive. |
| Include/exclude semantics | Exclusion arrays on the spec (068). Exclusion always wins. |
| Pure resolver and tests | `src/lib/audience/resolveAudience.ts` mirrors `resolve_audience_all`. Tests in `src/__tests__/audienceResolution.test.ts` (32 cases, Agent 5's coverage kept and extended). |
| Immutable selections | Specs are immutable (068). |
| Snapshot vs dynamic concept | Snapshot for all targeted content. Dynamic is kept only for meeting invitations, which are a live list by design. |
| Deduplication | Set semantics in the resolver and in the snapshot primary key. |
| Pending and rejected exclusion | Already in 059. Reaffirmed in every path. |
| Audit of recipients | `audience_publications` and `audience_snapshots`, in the same shape as Agent 5's intent. |

### Rejected

| Feature | Reason |
|---|---|
| `audience_groups` with owner and `organisation` visibility | Duplicates `saved_groups` (059). Staff-only groups (066) already give the needed privacy. Group ownership is deferred. |
| `audience_selections` and `audience_selection_terms` (term rows) | Duplicates `audience_specs`. Exclusions are columns on the spec. |
| `audience_resolutions` and `audience_recipients` | Duplicates `audience_publications` and `audience_snapshots`. |
| `audience_term_allowed` as a separate authority | Merged into `audience_caller_can_target` and `create_audience_spec`. One authority per check. |
| Agent 5's unnumbered SQL (`pending_migrations/audience_infrastructure.sql`) | Not reused. It was unverified, and the replay found it duplicated 059. |
| Agent 5's "live or frozen" toggle | Removed. Frozen is the only behavior for targeted content. |

### Deferred

| Feature | Why |
|---|---|
| Multi-select for **messages** in the composer UI | The send path accepts one mode today (067). Moving messages to `composite` needs a 067 change owned by Agent 3. |
| Group ownership and `organisation` visibility | Not needed for the current roles. |
| `meeting`-audience event visibility | Stays fellowship-visible, as before. Changing it is a product decision. |
| Email and push for messages | Owned by the dispatcher (Agent 3). |
| Consolidating `communication_recipients` into `audience_snapshots` | Same rule, different delivery model. Revisit after messaging certification passes. |

---

## 13. Security test summary

See `docs/audience-reconcile-certification.md` for the full evidence.

- Baseline (before this work) showed the enumeration path closed by 066, but broadcast-on-delete, leader broadcast, live re-resolution and the notify fallback still open.
- After 068 and 069: 66 of 66 real-session checks pass on an isolated PGlite replay of the whole chain.
- Notification routing: 15 unit tests, including static checks that the old fallback is gone and that `notify-event` uses the router and the snapshot RPC.
