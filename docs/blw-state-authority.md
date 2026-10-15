# BLW York Hub — State Authority Map

> This document declares the single authoritative source for every meaningful fact in the system.
> Its purpose: prevent duplicated authority and make future "where does this come from?" questions answerable in one place.

---

## Identity

| Question | Authority | Notes |
|---|---|---|
| Who is a person? | `people` | One row per human. Stable `id` forever. |
| What is their name? | `people.first_name + last_name` | |
| What is their email? | `people.email` | |
| What is their phone? | `people.phone` | |
| When did they first appear in the system? | `people.created_at` | |

---

## Ministry Relationship

| Question | Authority | Notes |
|---|---|---|
| Is someone currently a member? | `memberships WHERE person_id = ? AND status = 'active'` exists | Do NOT check `people.type` (no such column in production) |
| What is their ministry role? | `memberships.role` | `member \| cell_leader \| coordinator \| admin` |
| When did they join as a member? | `memberships.joined_at` | |
| Are they a contact (not yet a member)? | `contacts WHERE person_id = ?` exists AND no active `memberships` row | A contacts row alone does not mean they are NOT a member — check memberships |
| What is their contact stage? | `contacts.stage` | `contacted \| following_up \| invited \| connected \| membership_review` |
| How were they first reached? | `contacts.source` | |
| When was first contact made? | `contacts.first_contact_date` | |
| What was their contact history after becoming a member? | Still in `contacts` row — it is never deleted on conversion | |
| When and by whom were they converted? | `membership_transitions` | Append-only audit of every Contact ↔ Member change |

---

## Contact Ownership

| Question | Authority | Notes |
|---|---|---|
| Who owns/is responsible for a contact? | `contacts.rep_id` | FK to `people.id` |
| Who can see "My Contacts"? | All contacts WHERE `contacts.rep_id = current_user.person_id` | This is a filtered view, not a separate table |
| Has ownership ever changed? | `audit_events WHERE action = 'rep.reassigned' AND entity_id = contact.person_id` | |

---

## Cells

| Question | Authority | Notes |
|---|---|---|
| What cells exist? | `cells` | |
| Who leads a cell? | `cells.leader_id` | |
| Is a person assigned to a cell? | `person_cell_relationships WHERE person_id = ? AND ended_at IS NULL` | |
| What is their integration state? | `person_cell_relationships.state` | `assigned \| introduced \| connected \| member` |
| Is a contact being integrated? | `person_cell_relationships` row exists AND `state != 'member'` | `cell_id IS NOT NULL` alone is NOT sufficient proof of integration |
| What cells has someone ever been in? | Full `person_cell_relationships` history (including rows with `ended_at` set) | |

---

## Service Expectations

| Question | Authority | Notes |
|---|---|---|
| Was someone expected at a service? | `service_expectations WHERE service_id = ? AND person_id = ?` row exists AND `response != 'declined'` | |
| Why were they expected? | `service_expectations.source` + `service_expectations.explanation` | Snapshot text frozen at generation time |
| What was the attendance pattern that triggered the expectation? | `attendance_pattern_snapshots WHERE service_id = ? AND person_id = ?` | Separate snapshot row so pattern can never be retroactively recomputed |
| What was the Sep 20 expectation explanation even after future absences? | `attendance_pattern_snapshots.attended_count` / `lookback_count` at that row — never changes | |
| Was an expectation generated automatically or manually? | `service_expectations.source` → `attendance_pattern` = automatic; `outreach` = from rep confirmation; `manual` = added by coordinator |
| Did a contact confirm they are coming? | `service_expectations.response = 'confirmed'` | |
| Did they say maybe? | `service_expectations.response = 'maybe'` | |
| Are they NOT coming this week (exception)? | `service_expectations.response = 'declined'` (for members with exception) or `response = 'not-coming'` (for contacts) | Same table, same row — do NOT create a separate exceptions table |
| Why are they not coming? | `service_expectations.reason` | Free text: "Exam", "Travel", etc. |
| Did outreach change a contact from Maybe → Confirmed? | UPDATE the existing `service_expectations` row (`response = 'confirmed'`). Do NOT insert a second row. | UNIQUE(service_id, person_id) enforces this. |

---

## Attendance

| Question | Authority | Notes |
|---|---|---|
| Did someone actually attend a service? | `service_attendance WHERE service_id = ? AND person_id = ? AND status = 'attended'` | This is the ONLY authoritative source |
| When did they check in? | `service_attendance.checked_in_at` | Nullable — may have been recorded post-service |
| Who checked them in? | `service_attendance.checked_in_by` | |
| Were they a walk-in (unexpected)? | `service_attendance.is_walk_in = true` | |
| Did someone NOT attend despite being expected? | Expected row exists AND no `service_attendance` row with `status = 'attended'` | "Confirmed but absent" = expected AND no attended record |

**CRITICAL:**
- Expectation ≠ Confirmation ≠ Attendance
- Confirmation ≠ Attendance
- A walk-in that is NOT in the expectation list still creates an attendance record — do NOT create a retroactive expectation row for this

---

## Contact Visit Count

| Question | Authority | Notes |
|---|---|---|
| How many Sunday services has a contact attended? | `COUNT(service_attendance WHERE person_id = ? AND status = 'attended')` joined to `services WHERE service_type = 'sunday_morning'` | DERIVED — never stored as an independent field |
| What is "visit 1 of 3"? | The first attended Sunday service | |
| Visit 2? | Second attended Sunday service | |
| Visit 3 → membership ready? | Third attended Sunday service, before conversion | |
| Can visit count be edited manually? | No. Visits are determined by attendance records only. | If a record was wrong, correct `service_attendance` via the audit-tracked correction flow |

---

## Membership Readiness

| Question | Authority | Notes |
|---|---|---|
| Is a contact ready for membership review? | `contact_visit_count >= service_config.membership_visit_threshold` AND no active `memberships` row | Derived, not stored |
| What is the current threshold? | `service_config.membership_visit_threshold` (default: 3) | |
| Has the "ready" state been surfaced to coordinators? | Derived at query time — no stored flag | |
| Has someone been converted? | `memberships` row exists AND `membership_transitions` row with `to_state = 'member'` | |
| Was conversion authorized? | `membership_transitions.converted_by` | |

**No automatic conversion.** The system surfaces "ready for membership review." An authorized coordinator must act to convert.

---

## After-Service Queues

All queues are derived at query time from attendance and expectation data. No separate stored queue.

| Queue | Derivation |
|---|---|
| First-time guests | `service_attendance.is_walk_in = false AND contact_visit_count = 1 AND status = 'attended'` this service |
| Returning guests | `contact_visit_count = 2 AND status = 'attended'` this service |
| Ready for membership | `contact_visit_count >= threshold AND no active membership` |
| Confirmed but absent | `service_expectations.response = 'confirmed' AND no attended service_attendance` |
| Regular members absent | `service_expectations.source = 'attendance_pattern' AND response != 'declined' AND no attended service_attendance` |
| Walk-in guests needing assignment | `service_attendance.is_walk_in = true AND contacts.rep_id IS NULL` |
| Unassigned guests | Walk-ins with no rep assigned |

---

## My Contacts (Filtered View)

| Question | Authority | Notes |
|---|---|---|
| Whose contacts are "mine"? | `contacts WHERE rep_id = current_user.person_id` | |
| Active contacts | `contacts.stage != 'converted'` AND no active membership (contextual) | |
| Follow-up due | `follow_ups WHERE owner_id = ? AND status = 'open' AND due_date <= today` | |
| Expected Sunday | `service_expectations.response IN ('confirmed', 'maybe', 'expected')` for next service | |
| Confirmed Sunday | `service_expectations.response = 'confirmed'` | |
| Maybe Sunday | `service_expectations.response = 'maybe'` | |
| Attended once | `contact_visit_count = 1` | |
| Attended twice | `contact_visit_count = 2` | |
| Ready for membership | `contact_visit_count >= threshold` | |

"My Contacts" is a filtered operational view of existing contact data. It is NOT a separate dataset.

---

## Follow-Up

| Question | Authority | Notes |
|---|---|---|
| What follow-up exists for a person? | `follow_ups WHERE person_id = ?` | |
| What is due today? | `follow_ups WHERE status = 'open' AND due_date <= today` | |
| What is overdue? | `follow_ups WHERE status = 'open' AND due_date < today` | |
| Was it completed? | `follow_ups.status = 'completed' AND completed_at IS NOT NULL` | |

---

## Service Lifecycle

| State | What it means | What is allowed |
|---|---|---|
| `scheduled` | Service is upcoming | Expected list can be generated; outreach confirmations update it; exceptions can be recorded |
| `active` | Service is happening now | Check-in is available; walk-ins can be recorded |
| `completed` | Service is over | Attendance is historical; after-service queues are queryable; follow-up work begins; corrections via authorized correction flow only |
| `cancelled` | Service was cancelled | Records preserved; no attendance recorded |

Transition: `scheduled → active → completed`. Admin may cancel from any state. Historical records from completed services are never silently mutated.

---

## Corrections

| Operation | Authority | Audit required? |
|---|---|---|
| Correct a wrong attendance record | `service_attendance` UPDATE | Yes — `audit_events` with before/after |
| Remove duplicate walk-in | DELETE from `service_attendance` | Yes — `audit_events` |
| Correct attendance mode | `service_attendance.attendance_mode` UPDATE | Yes |
| Correct wrong person checked in | UPDATE person_id or delete+reinsert | Yes |
| Reverse a membership conversion | `membership_transitions` (new row, to_state = 'contact') + update `memberships.status` | Yes |

All corrections are performed by authorized users (coordinator+). The audit trail is in `audit_events`, not by editing historical records in place.

---

## Growth (Personal)

| Question | Authority | Notes |
|---|---|---|
| Has user read today's devotional? | `devotional_completions WHERE person_id = ? AND date = today` | |
| Current devotional streak? | `MAX consecutive daily completions` derived from `devotional_completions` | |
| Prayer log | `prayer_logs WHERE person_id = ?` | |
| Book reading progress | `book_reading_progress WHERE person_id = ?` | |
| Confessions completion | `confession_completions WHERE person_id = ?` | |
| Testimonies | `testimonies WHERE person_id = ?` | |

Growth records are personal — each user sees only their own.

---

## Admin / Configuration

| Question | Authority | Notes |
|---|---|---|
| Attendance threshold | `service_config.attendance_threshold` | Default: 5 (of `attendance_lookback` = 8) |
| Membership visit threshold | `service_config.membership_visit_threshold` | Default: 3 |
| Who has admin role? | `memberships WHERE role IN ('admin', 'coordinator')` | |
| Pending signups | `memberships WHERE status = 'pending'` (or a signup_requests table) | |
| Email notifications | Email logs and preference tables | |
