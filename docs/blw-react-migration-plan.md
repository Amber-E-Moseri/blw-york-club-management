# BLW York Hub — React + Supabase Migration Plan

> Do NOT execute this plan in this branch. This branch (`feat/prototype-ui-integration`) closes the prototype architecture only.
> Each branch below is a separate, shippable increment.
> Prototype reference: `BLW_York_Hub_v2.html`

---

## Guiding Principles

1. **Prototype is the product reference.** Every branch targets visual and behavioral parity with `BLW_York_Hub_v2.html`.
2. **Schema before UI.** Branches 1–3 establish data before building interfaces.
3. **One source of truth per fact.** State authority map (`docs/blw-state-authority.md`) is the tie-breaker for implementation disputes.
4. **No speculative features.** Build only what the prototype demonstrates or the production contracts explicitly require.
5. **Each branch must leave the app in a working, deployable state.**

---

## Branch 1 — Core Schema + Person Identity

**Goal:** Establish the foundational database schema. All subsequent branches depend on it.

### Scope

- Create Supabase migrations for:
  - `people`
  - `contacts`
  - `memberships`
  - `membership_transitions`
  - `service_config` (singleton with defaults)
- Write seed data for development: 7 members + 7 contacts from the prototype
- Add RLS policies for `people` (authenticated read; coordinator+ write)
- Write a person-creation helper that checks for duplicate email/phone before inserting
- Write the `mergePeople(sourceId, targetId)` utility (admin-only, deferred UI)

### Dependencies

None. First branch.

### Files / domains likely affected

- `supabase/migrations/` — new migration files
- `src/lib/supabase.ts` — client setup
- `src/lib/people.ts` — person CRUD helpers
- `src/lib/duplicateCheck.ts` — email/phone lookup before create
- `scripts/seed-dev.ts` — development seed

### Tests required

- Person uniqueness: inserting duplicate email rejects with descriptive error
- Person uniqueness: inserting duplicate phone rejects
- Partial unique: two people with null email can coexist
- Merge: `mergePeople` transfers attendance, interactions, contacts, cell relationships to target id and soft-deletes source

### Exit criteria

- Migrations apply cleanly on a fresh Supabase project
- Seed script populates 14 people records matching prototype data
- No React changes in this branch

### Non-goals

- Authentication UI
- React components
- Service or attendance tables (Branch 4)

---

## Branch 2 — People + Contacts Repositories / API

**Goal:** Build the data access layer for people and contacts, and render the People page using real data.

### Scope

- Supabase migrations for:
  - `cells`
  - `person_cell_relationships`
- React: replace hardcoded `PEOPLE` array with Supabase queries
- Implement `usePeople()` hook (all people, filterable by type)
- Implement `useContacts()` hook (contacts with rep info, stage, source)
- Implement `usePerson(id)` hook (single person + associated data for profile drawer)
- Render People page (`/people`) with real data:
  - All / Members / Contacts tabs
  - Search by name
  - Cell column (from `person_cell_relationships`)
  - Status column (from `memberships` or `contacts`)
- Render profile drawer for members (contact info, attendance pattern from `service_attendance` if available, cell assignment)
- Render profile drawer for contacts (contact info, stage, rep, interactions stub)
- "Add person" modal writes to `people` + `contacts` or `memberships`

### Dependencies

Branch 1 (people, contacts, memberships tables).

### Files / domains likely affected

- `src/hooks/usePeople.ts`
- `src/hooks/useContacts.ts`
- `src/hooks/usePerson.ts`
- `src/pages/People.tsx` (new, replacing Members.tsx)
- `src/components/feature/PersonDrawer.tsx`
- `src/components/feature/PersonTable.tsx`
- `src/components/feature/PersonCard.tsx`
- `src/lib/queries/people.ts`
- `src/lib/queries/cells.ts`

### Tests required

- People filter: Members tab returns only people with active memberships
- People filter: Contacts tab returns only people with contacts row and no active membership
- Search: name search returns correct results
- Profile drawer renders correct section (contact vs member) based on membership state

### Exit criteria

- People page renders real data from Supabase
- Profile drawer opens and shows correct person type
- "Add person" creates a record and it appears in the list
- No hardcoded PEOPLE array in any active component

### Non-goals

- Contact interactions (Branch 3)
- Attendance data (Branch 5)
- Visit count (Branch 5)

---

## Branch 3 — Outreach Interactions + Follow-Ups

**Goal:** Build the Outreach CRM page with real interaction history and follow-up management.

### Scope

- Supabase migrations for:
  - `contact_interactions`
  - `follow_ups`
- Implement `useContactInteractions(personId)` hook
- Implement `useFollowUps(ownerId?)` hook
- Render Outreach CRM page (`/outreach`):
  - Table view with stage, rep, source, next follow-up
  - Pipeline (Kanban) view with 5 stages
  - "Log contact" modal writes person + contact + initial interaction
  - "Record interaction" modal (from profile drawer) writes to `contact_interactions`
- Render interaction timeline in profile drawer
- Render follow-up list in profile drawer
- "My Contacts" filtered view (rep = current user)
- CRM stats: active contacts, follow-up due today, etc.

### Dependencies

Branch 2 (people, contacts tables and hooks).

### Files / domains likely affected

- `src/pages/OutreachHub.tsx` (already exists as wrapper; now wire real data)
- `src/hooks/useContactInteractions.ts`
- `src/hooks/useFollowUps.ts`
- `src/components/feature/InteractionTimeline.tsx`
- `src/components/feature/FollowUpList.tsx`
- `src/components/feature/CrmKanban.tsx`
- `src/lib/queries/interactions.ts`
- `src/lib/queries/followUps.ts`

### Tests required

- Interaction create: `interaction_type`, `occurred_at`, `notes` all required
- Follow-up due today query: returns correct records on boundary date
- Pipeline stage: contacts with `stage = 'membership_review'` derived from visit count, not stage field
- "My contacts" query: filters correctly by `rep_id = current_user.person_id`

### Exit criteria

- CRM shows real contacts with real interactions
- Interaction timeline renders in profile drawer
- "Log contact" creates person + contact + interaction in one transaction
- Follow-up due counts are real

### Non-goals

- Sunday response / service expectations (Branch 4)
- Visit count (Branch 5)

---

## Branch 4 — Services + Expectation Model

**Goal:** Build the Services page with the expected list and exception recording against real data.

### Scope

- Supabase migrations for:
  - `services`
  - `service_expectations`
  - `attendance_pattern_snapshots`
- Implement `useService(id)` hook
- Implement `useServiceExpectations(serviceId)` hook
- Implement expectation generation algorithm:
  - Query `service_attendance` for each member over last `service_config.attendance_lookback` Sundays
  - Members meeting `attendance_threshold` get a `service_expectations` row with `source = 'attendance_pattern'`
  - Write explanation snapshot + `attendance_pattern_snapshots` row
- Services page (`/services`):
  - Service selector (upcoming + past)
  - Expected tab with "Why expected" column (reads from `service_expectations.explanation`)
  - Exceptions tab (set `response = 'declined'` on existing expectation row)
  - "Set Sunday response" in CRM writes to `service_expectations` (upsert, not insert)
  - Exception from profile drawer writes to `service_expectations` (upsert)
  - "Send confirmations" queues email (stub with log entry)
- Service stats (expected count, members vs contacts, confirmed count)
- History tab shows past services from `services` table

### Dependencies

Branch 3 (interactions for contacts; people for the expectation population list).

### Files / domains likely affected

- `src/pages/ServicesHub.tsx`
- `src/hooks/useService.ts`
- `src/hooks/useServiceExpectations.ts`
- `src/lib/expectationEngine.ts` — pattern algorithm
- `src/components/feature/ExpectedList.tsx`
- `src/components/feature/ExceptionsList.tsx`
- `src/lib/queries/services.ts`
- `src/lib/queries/expectations.ts`
- `supabase/functions/generate-expectations/` — edge function or server action

### Tests required

- Expectation generation: member with 5/8 attendance receives expectation row
- Expectation generation: member with 4/8 does not
- Explanation snapshot: rerunning algorithm does NOT overwrite existing explanation
- Exception upsert: setting `response = 'declined'` on an existing expectation updates, not duplicates
- Response upsert: Contact changing from `maybe` to `confirmed` updates the same row (UNIQUE enforced)
- Historical explanation: Sep 20 snapshot reads "7 of previous 8" even after future absences change pattern

### Exit criteria

- Expected list renders real expectations from Supabase
- "Why expected" column shows snapshotted explanation text
- Exceptions are recorded and persist across page refreshes
- Sunday response buttons update `service_expectations.response` in real time

### Non-goals

- Actual attendance check-in (Branch 5)
- Visit count derivation (Branch 5)

---

## Branch 5 — Attendance + Check-In

**Goal:** Build the check-in workflow and make visit count authoritative from `service_attendance`.

### Scope

- Supabase migration for:
  - `service_attendance`
- Implement `useServiceAttendance(serviceId)` hook
- Check-in tab:
  - Search expected people by name
  - Check in button writes `service_attendance` row with `status = 'attended'`
  - Uncheck removes or updates to `status = 'absent'`
  - Walk-in modal: search existing person or create new → write `service_attendance.is_walk_in = true`
- Derive contact visit count from `service_attendance` (Sunday services only)
- Replace `S.visits` prototype state with real query
- Walk-in count shown in real time
- Check-in count shown in service stats
- Service lifecycle: when coordinator marks service "completed," lock check-in tab

### Dependencies

Branch 4 (services, expectations).

### Files / domains likely affected

- `src/pages/ServicesHub.tsx` — Check-in tab
- `src/hooks/useServiceAttendance.ts`
- `src/hooks/useContactVisitCount.ts`
- `src/components/feature/CheckInList.tsx`
- `src/components/feature/WalkInModal.tsx`
- `src/lib/queries/attendance.ts`

### Tests required

- Check-in: writes `service_attendance` with correct fields
- Visit count: `COUNT` query returns correct integer for each contact
- Walk-in: creates person + contact + attendance in one transaction
- Walk-in: existing person search finds by name and phone
- Double-check prevention: checking in same person twice returns error / is idempotent
- Uncheck: removes attended status; visit count decrements accordingly

### Exit criteria

- Check-in tab works end-to-end with real data
- Visit count on profile drawer is derived from real `service_attendance` query
- Walk-in correctly creates new person if not found
- No `S.visits` or `S.checkedIn` state in production code paths

### Non-goals

- After-service queues (Branch 9)
- Attendance corrections (Branch 10)

---

## Branch 6 — Expectation Learning + Weekly Exceptions

**Goal:** Make the regular-attendance expectation algorithm production-robust and wire exception management end-to-end.

### Scope

- Schedule expectation generation (edge function / cron):
  - Runs when a new Sunday service is created or `status → scheduled`
  - Reads `service_config.attendance_lookback` and `attendance_threshold`
  - Generates `service_expectations` rows for qualifying members
  - Writes `attendance_pattern_snapshots` rows (idempotent)
- Exception full workflow:
  - Exception modal (reason select: Exam / Work / Travel / Sick / Family / Other)
  - "Not coming this Sunday" from profile drawer prompts for reason
  - Removing an exception restores `response` to `'expected'`
- Threshold configurable from Admin config UI (writes `service_config`)
- Verify snapshot immutability: completed service expectations read from frozen snapshot, not recomputed

### Dependencies

Branch 5 (attendance, for lookback query).

### Files / domains likely affected

- `supabase/functions/generate-expectations/` — production cron
- `src/components/feature/ExceptionModal.tsx` (add reason select)
- `src/pages/AdminHub.tsx` — service configuration card
- `src/lib/queries/serviceConfig.ts`

### Tests required

- Cron: expectations generated correctly for a new Sunday service
- Cron is idempotent: running twice does not create duplicate rows (UNIQUE constraint + upsert)
- Exception with reason: reason field stored on `service_expectations.reason`
- Threshold change: changing threshold from 5 to 6 affects future expectation generation only, not historical rows
- Snapshot immutability: test that updating a person's attendance after the snapshot does not change `attendance_pattern_snapshots.attended_count`

### Exit criteria

- Exception workflow includes reason prompt from all entry points
- Expectation generation runs automatically when a service is scheduled
- Threshold is configurable from Admin UI
- Historical explanations are frozen and readable

### Non-goals

- After-service queues (Branch 9)
- Audit hardening (Branch 10)

---

## Branch 7 — Contact Visit Progression + Membership Review

**Goal:** Wire the full contact lifecycle from first visit to membership conversion.

### Scope

- "Ready for membership review" surface points:
  - People directory stat chip (derived query)
  - CRM Kanban "Membership Review" column (derived from visit count)
  - After Service derived queue (Branch 9 wires the UI)
  - Profile drawer "Convert to member" button
- "Convert to member" action:
  - Requires coordinator role (enforced in RLS + UI)
  - Writes `memberships` row
  - Writes `membership_transitions` row
  - Writes `audit_events` row
  - Shows confirmation dialog before executing
  - Preserves `contacts`, `contact_interactions`, `service_attendance`, `follow_ups`, `person_cell_relationships`
- Service journey steps in profile drawer derive from real visit count
- "Membership Review" stage on `contacts.stage` is set by the system when threshold is reached, and cleared on conversion

### Dependencies

Branches 5 (visit count) and 2 (memberships).

### Files / domains likely affected

- `src/components/feature/ConvertToMemberModal.tsx`
- `src/hooks/useMembershipReadiness.ts`
- `src/lib/membershipTransition.ts`
- `src/lib/queries/membershipTransitions.ts`

### Tests required

- Contact visit count at 0, 1, 2, 3 shows correct journey step in profile drawer
- "Convert to member" requires coordinator role — contact rep cannot trigger it
- Conversion: `membership_transitions` row created with `from_state = 'contact'`, `to_state = 'member'`, `converted_by = current_user`
- Conversion: `contacts` row retained, `contact.stage` unchanged (history preserved)
- Post-conversion: person appears in Members tab, not Contacts tab
- Post-conversion: contact's interaction history still readable in profile drawer

### Exit criteria

- Full Contact → Member flow works end-to-end
- Membership transition audit trail is complete
- "Ready for membership" surfaces correctly in all 4 locations

### Non-goals

- After-service automation (Branch 9)

---

## Branch 8 — Cells

**Goal:** Build the Cells page with real data and cell detail interaction.

### Scope

- Cells grid renders from `cells` + `person_cell_relationships`
- Cell card: name, leader, member count, integrating contacts count
- Cell detail view (not in prototype — gap C-1): member list, integration states, leader contact
- "Assign to cell" action in profile drawer / People page
- Update integration state (`assigned → introduced → connected → member`)
- "New cell" modal writes to `cells`
- Cell leader assignment updates `cells.leader_id`

### Dependencies

Branch 2 (people, person_cell_relationships).

### Files / domains likely affected

- `src/pages/CellsHub.tsx`
- `src/components/feature/CellCard.tsx`
- `src/components/feature/CellDetail.tsx` (new)
- `src/components/feature/AssignCellModal.tsx`
- `src/hooks/useCells.ts`
- `src/lib/queries/cells.ts`

### Tests required

- Cell grid shows correct member count from `person_cell_relationships`
- Integrating contacts count: contacts with `person_cell_relationships` row and no active membership
- Assign to cell: creates `person_cell_relationships` row; previous active relationship ends (`ended_at` set)
- Integration state update: only cell leader or coordinator can update state

### Exit criteria

- Cells page renders real data
- Cell detail shows member list and integration states
- Assign-to-cell works from profile drawer

### Non-goals

- Cell meeting attendance (deferred)

---

## Branch 9 — After-Service Workflows + My Contacts

**Goal:** Build the After Service tab and the "My Contacts" operational view.

### Scope

- After Service tab on Services page:
  - First-time guests queue (derived from attendance + visit count = 1)
  - Returning guests queue (visit count = 2)
  - Ready for membership (visit count ≥ threshold)
  - Confirmed but absent (expectation = confirmed AND no attended record)
  - Regular members absent (expected + no attended record)
  - Walk-in guests needing rep assignment
  - "Assign rep" action for walk-ins
  - "Create follow-up" action for confirmed-but-absent contacts
- "My Contacts" page or CRM filter:
  - Shows contacts where `rep_id = current_user.person_id`
  - Sub-sections: Active / Follow-up due / Expected Sunday / Confirmed / Maybe / 1 visit / 2 visits / Ready
- Follow-up generation: After service completion, system creates follow-up for each confirmed-but-absent contact

### Dependencies

Branches 3 (follow-ups), 4 (expectations), 5 (attendance), 7 (visit count).

### Files / domains likely affected

- `src/components/feature/AfterServiceGrid.tsx`
- `src/hooks/useAfterService.ts`
- `src/pages/MyContacts.tsx`
- `src/lib/queries/afterService.ts`
- `supabase/functions/after-service-followups/` — optional automation

### Tests required

- First-time guest: contact with exactly 1 attended Sunday service appears in first-time queue
- Confirmed but absent: correct derivation (expectation confirmed + no attendance record)
- "My contacts" filter: correct isolation by rep_id
- Walk-in assignment: assigns rep, follow-up created

### Exit criteria

- After Service tab shows real derived queues
- "My Contacts" view operational
- Follow-ups created for confirmed-but-absent contacts after service completion

---

## Branch 10 — Authorization + Audit Hardening

**Goal:** Enforce the authorization matrix in RLS and add audit logging for all consequential operations.

### Scope

- Supabase migration for `audit_events`
- Full RLS policy review across all tables (per `docs/blw-authorization-matrix.md`)
- Row-level filters for Contact Rep (own contacts only) and Cell Leader (own cell only)
- Audit event writes for:
  - Contact → Member conversion
  - Attendance correction (post-completed service)
  - Rep reassignment
  - Role changes
  - Cell leadership changes
  - Service cancellation
  - Admin config changes
- Attendance correction UI: coordinator can edit `service_attendance` on completed services
  - Records `audit_events` with before/after data
  - Shown in service history detail
- Person merge UI (admin): merge duplicate people preserving all history

### Dependencies

All prior branches.

### Files / domains likely affected

- `supabase/migrations/` — audit_events + RLS updates
- `src/lib/audit.ts`
- `src/pages/AdminHub.tsx` — audit log viewer
- `src/components/feature/AttendanceCorrectionModal.tsx`
- `src/components/feature/PersonMergeModal.tsx`
- All `src/lib/queries/*.ts` — add audit calls

### Tests required

- RLS: Contact rep can only read their own contacts (not others')
- RLS: Cell leader can read their cell members
- RLS: Coordinator can read all contacts
- Audit: membership conversion creates `audit_events` row with before/after
- Audit: attendance correction creates `audit_events` row
- Person merge: merged person retains all attendance, interaction, and membership records under target id

### Exit criteria

- All RLS policies in place and tested
- Audit log populated for all defined consequential operations
- Attendance correction available to coordinators with audit trail
- Person merge operational for admins

---

## Branch 11 — Dashboard Integration

**Goal:** Wire the Dashboard to real data across all domains.

### Scope

- All dashboard stat chips derive from real queries
- Service hero widget: real expected count from `service_expectations`
- Upcoming ministry moments: real events from `events` table
- Today's focus: real habit completions from `devotional_completions` / `prayer_logs`
- Follow-up pulse: real counts from `follow_ups`
- "3 contacts due today" from real `follow_ups WHERE due_date = today AND status = 'open'`
- "2 contacts at 2/3 visits" from real visit count query
- Quick actions wire to real modals

### Dependencies

All prior branches.

### Files / domains likely affected

- `src/pages/Dashboard.tsx`
- `src/hooks/useDashboard.ts`
- `src/lib/queries/dashboard.ts`

### Tests required

- Stat chip counts match underlying table queries
- Follow-up pulse correctly surfaces due-today count
- Dashboard renders correctly with zero contacts (empty state)

### Exit criteria

- Dashboard shows real data across all stat chips and widgets
- No hardcoded numbers

---

## Branch 12 — Prototype Visual Parity + Mobile Polish

**Goal:** Achieve full visual parity with `BLW_York_Hub_v2.html` and harden mobile experience.

### Scope

- Audit every page against the prototype for visual differences
- Fix bottom nav to expose Cells, Meetings, Events (gap MB-1):
  - Add "More" tab or restructure to Home / People / CRM / Service / More
- Meetings page: full meeting CRUD with agenda, minutes, action items
- Events page: full event CRUD with RSVP tracking
- Growth page: wire all growth features to real data
- Admin page: wire pending approvals, role management, reports, email log, data health
- Performance: virtualize long lists (People, Expected)
- Accessibility audit: focus management in drawer and modals, ARIA labels
- Mobile viewport testing at 375px for all pages

### Dependencies

All prior branches.

### Files / domains likely affected

- All pages and feature components
- `src/components/layout/BottomNav.tsx` — add More / restructure
- `src/pages/Meetings.tsx` — full implementation
- `src/pages/Events.tsx` — full implementation
- `src/pages/Growth.tsx` — full implementation
- `src/pages/AdminHub.tsx` — full implementation

### Tests required

- Visual regression tests against prototype screenshots (key pages)
- Mobile layout: bottom nav accessible at 375px for all destinations
- Accessibility: keyboard navigation works for drawer and modals

### Exit criteria

- All prototype pages have production-quality implementations
- Mobile navigation reaches all 9 destinations
- No known visual regressions from prototype reference

---

## Test Strategy Summary

| Test | Branch |
|---|---|
| Person uniqueness (email/phone) | 1 |
| Contact → Member preserves person ID | 7 |
| Outreach "Coming" → expectation row | 4 |
| Maybe → Coming updates same expectation row | 4 |
| Regular attendance expectation generation | 6 |
| Explanation snapshot remains historical | 6 |
| One-week exception recorded | 6 |
| Exception does not change future regular expectation | 6 |
| Expectation ≠ attendance | 5 |
| Unexpected existing-person arrival (walk-in) | 5 |
| Walk-in new person creates record | 5 |
| Contact visit 1 | 5 |
| Contact visit 2 | 5 |
| Contact visit 3 → membership ready surfaced | 7 |
| No auto-conversion | 7 |
| Authorized membership conversion | 7 |
| Attendance correction audit | 10 |
| Duplicate person prevention | 1 |
| Cell integration states | 8 |
| Completed service history preserved | 10 |
| Authorization boundaries (RLS) | 10 |

---

## Recommended First Implementation Branch

**Start with Branch 1 — Core Schema + Person Identity.**

Reason: Every subsequent branch depends on the `people` table. The schema is simple (one migration, one seed, one uniqueness check), carries no React complexity, and produces a clean foundation. It can be completed in one sitting and unblocks all other work.

After Branch 1 is merged, Branch 2 (People page with real data) and Branch 3 (Outreach interactions) can proceed in parallel on separate branches since they do not depend on each other.
