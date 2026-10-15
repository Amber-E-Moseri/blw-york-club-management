# BLW York Hub v2 — Product Map

> Source: `BLW_York_Hub_v2.html` (Sep 15 2026, frozen prototype)
> Purpose: Authoritative feature/interaction reference for the React + Supabase implementation.

---

## 1 — Dashboard

| Field | Value |
|---|---|
| **Page** | `dashboard` (default) |
| **Primary entity** | Aggregated view across all domains |
| **Actions** | Open devotional · Mark habit complete · Navigate to service workspace · Log contact · Add meeting · Share testimony · Create event · Open CRM |
| **State changes** | None — read-only aggregation. Quick-action buttons open modals that mutate other domains. |
| **Dependencies** | people, services, habits, contacts, follow_ups, events |
| **Production persistence required?** | No new writes; reads from all other domains. Dashboard stats are derived. |
| **Authorization implications** | All coordinator+ roles see full dashboard. Members see personal view (habits, growth, their cell). |

**JS state consumed:**
- `expectedList()` — derived from member attendance patterns + contact sundayResp
- `S.checkedIn.size + S.walkins.length`
- PEOPLE count, contact count, habit progress (hardcoded in prototype)

**UI sections:**
1. Greeting + date chip
2. Four stat chips: People / Active contacts / Next Sunday expected / Habit completion
3. Today's Daily Bread card (devotional)
4. Upcoming ministry moments (next 3 events)
5. Service hero widget: expected count, members/contacts/confirmed/checked-in breakdown, link to service workspace
6. Today's focus (habit progress)
7. Quick actions: Log contact · Add meeting · Testimony · New event
8. Follow-up pulse: contacts due today, contacts expected Sunday, contacts near membership

---

## 2 — People

| Field | Value |
|---|---|
| **Page** | `people` |
| **Primary entity** | `people` (members and contacts unified) |
| **Actions** | Add person · Filter by tab (All/Members/Contacts) · Search by name · Filter by cell · Filter by stage · Click row → open profile drawer |
| **State changes** | Tab selection, search filter (UI only) |
| **Dependencies** | people, contacts, memberships, cells, service_expectations, service_attendance |
| **Production persistence required?** | Yes — people records, membership state |
| **Authorization implications** | All authenticated users can view. Add/edit requires leader+ role. |

**Table columns:** Person · Type · Cell/Rep · Status · Next Sunday · Visits/Attendance pattern

**Stats:**
- Total people (135)
- Members (128 with 18 leaders)
- Active contacts (7)
- Ready for membership (derived: contacts with ≥3 attended services, not yet converted)

**"Ready for membership" counter** is live-derived; not stored.

---

## 3 — Outreach CRM

| Field | Value |
|---|---|
| **Page** | `outreach` |
| **Primary entity** | `contacts` (people with contact relationship) |
| **Actions** | Log contact (modal) · Toggle table/pipeline view · Search · Filter by owner/stage · Set Sunday response (Coming/Maybe/Not coming) per contact · Click → profile drawer |
| **State changes** | `S.sundayResp[id]` — mutated on button click; cascades to Expected list, service counts, dashboard |
| **Dependencies** | contacts, contact_interactions, follow_ups, service_expectations |
| **Production persistence required?** | Yes — contacts, interactions, follow_ups, service_expectations |
| **Authorization implications** | Reps see their own contacts by default. Coordinators see all. |

**Table view columns:** Contact · Stage · Rep · Source · Visits (dots) · Next follow-up date · Sunday Sep 20 response

**Pipeline view:** 5 Kanban columns — Contacted / Following Up / Invited / Connected / Membership Review.
- "Membership Review" column is dynamically populated (visits ≥3, not converted).

**Response buttons (per contact):** Coming → `confirmed` · Maybe → `maybe` · Not coming → `not-coming`
- Toggle: clicking the active state deselects it (sets `null`).
- `confirmed` or `maybe` → adds contact to expected list for that service.
- `not-coming` → removes from expected list.
- Setting `confirmed` triggers toast: "added to Sunday expected list."

**Stats:** Active contacts · Follow-up due (today) · Expected Sunday · Ready for membership

---

## 4 — Services

| Field | Value |
|---|---|
| **Page** | `services` |
| **Primary entity** | `services` + `service_expectations` + `service_attendance` |
| **Actions** | Select service · Filter expected list · Send confirmations · Check in person · Record exception · Remove exception · Add walk-in · Add person to service · Convert to member (from expected list) |
| **State changes** | `S.checkedIn`, `S.walkins`, `S.exceptions`, `S.exceptionReasons`, `S.visits`, `S.converted` |
| **Dependencies** | services, people, service_expectations, service_attendance, contacts, memberships |
| **Production persistence required?** | Yes — all service and attendance state |
| **Authorization implications** | Check-in is available to door team / any authenticated user. Conversion requires coordinator. |

### 4a — Expected Tab

- Lists people where `isMemberExpected(p)` OR `isContactExpected(id)`.
- "Why expected" column:
  - Members: "↻ Regular · N of last 8 Sundays"
  - Contacts: "↗ Outreach · Explicitly confirmed / Invited, said maybe"
- Confirmation column: members show "Expected" badge; contacts show "Confirmed" or "Maybe."
- Attendance column: check-in button OR "Convert to member" if visits ≥3.
- Filter bar: All / Members / Contacts / Confirmed / Maybe

**Regular attendance algorithm (prototype):**
```
isRegular(p) = p.type === 'member' && sum(p.pat) >= 5  // out of 8
isMemberExpected(p) = isRegular(p) && !S.exceptions.has(p.id)
```
Threshold: **5 of 8** most recent Sundays. Configurable in Admin (prototype shows "5 of 8" as default).

### 4b — Check-in Tab

- Large search field (name lookup).
- "Expected people" card with check-in buttons.
- "Walk-ins & unexpected arrivals" card.
- "＋ Walk-in / unexpected" button → modal.
- Checking in a contact increments `S.visits[id]`.
- At visit 3: toast "Third attended service — ready for membership review."

### 4c — Exceptions Tab

- Lists members with exception for this service.
- Shows: name, normally-expected pattern, reason (Exam / Out of town / etc.).
- "Remove" button restores them to expected.
- Reasons available: Exam / Work / Travelling / Sick / Family / Other.
- Exception badge count shown on tab.

### 4d — After Service Tab

Derived queue cards (not stored separately):
1. First-time guests (checked-in contacts with visits = 1)
2. Returning guests (visits = 2)
3. Ready for membership (visits ≥3, not converted) — highlighted
4. Confirmed but absent (sundayResp = confirmed AND not checked in)
5. Regular members absent (isMemberExpected AND not checked in)
6. Walk-in guests (unassigned new arrivals)

### 4e — History Tab

- Past service cards: date, attended count, confirmed count, first-time guests, contacts.
- Selector for past services: Sep 13 / Sep 6 / Aug 30.

---

## 5 — Cells

| Field | Value |
|---|---|
| **Page** | `cells` |
| **Primary entity** | `cells` + `person_cell_relationships` |
| **Actions** | New cell (modal) · Click cell card → detail (toast stub) |
| **State changes** | None (read-only in prototype) |
| **Dependencies** | cells, people (members + contacts) |
| **Production persistence required?** | Yes — cells, person_cell_relationships |
| **Authorization implications** | View: all. Create/edit cell: coordinator. Assign members: cell leader+. |

**Cell card fields:** Name · Member count · Description · Leader avatar + name · Integrating contacts count (contacts with that cell assigned)

**Stats:** Active cells (5) · Cell leaders (5) · Members in cells (128) · Contacts integrating (4)

---

## 6 — Meetings

| Field | Value |
|---|---|
| **Page** | `meetings` |
| **Primary entity** | `meetings` |
| **Actions** | Schedule meeting (modal) · Join meeting · View agenda · Open minutes |
| **State changes** | None (prototype stubs with toast) |
| **Dependencies** | meetings, meeting_agendas, meeting_minutes, meeting_action_items |
| **Production persistence required?** | Yes — meetings, agendas, minutes, action items |
| **Authorization implications** | Schedule: leader+. Join/view: attendees. Minutes: coordinator. |

**Meeting types shown:** Senior Cell Leaders · Central Subregion · Executive Team
**Meeting states shown:** Upcoming · Planned · Minutes ready

---

## 7 — Events

| Field | Value |
|---|---|
| **Page** | `events` |
| **Primary entity** | `events` |
| **Actions** | Create event (modal) · Click "Open service" → navigate to Services page |
| **State changes** | None (static list in prototype) |
| **Dependencies** | events, services |
| **Production persistence required?** | Yes — events |
| **Authorization implications** | View: all. Create/edit: coordinator. |

**Event types shown:** Bible Study · Cell · (Sunday) Service · Outreach · Foundation
- Sunday Service event has a direct link to the service workspace.
- Other events show RSVP counts.

---

## 8 — Growth

| Field | Value |
|---|---|
| **Page** | `growth` |
| **Primary entity** | Personal growth records (devotionals, habits, books, confessions, testimonies) |
| **Actions** | Open devotional · Open confessions player · Share testimony · Browse messages library |
| **State changes** | Read & mark complete (devotional) · Devotional streak |
| **Dependencies** | devotional_completions, prayer_logs, book_reading, confessions, testimonies |
| **Production persistence required?** | Yes — per-person growth records |
| **Authorization implications** | Personal — each user sees their own records only. |

**Cards:** Daily Bread (streak) · Prayer (weekly log) · Book of Month (progress %) · Weekly Confessions · Testimonies · Messages Library

---

## 9 — Admin Centre

| Field | Value |
|---|---|
| **Page** | `admin` |
| **Primary entity** | Configuration + administrative records |
| **Actions** | Review approvals · Manage roles · Open reports · Configure service settings · Open email log · View data health |
| **State changes** | Badge count (6 pending approvals shown in nav) |
| **Dependencies** | people, roles, service_config, email_logs, audit_events |
| **Production persistence required?** | Yes — all admin and config tables |
| **Authorization implications** | Admin/Coordinator only |

**Cards:** Pending approvals (6) · Role management (18 leaders) · Reports & exports · Service configuration · Email centre · Data health

**Service configuration fields (prototype caption):**
- Regular service day
- Attendance threshold: 5 of 8 (for regular-attendance expectation)
- Membership threshold: 3 attended services

---

## 10 — Profile Drawer (Person Detail Panel)

| Field | Value |
|---|---|
| **Trigger** | Click any person row in People, CRM, or Expected list; global search result |
| **Primary entity** | `people` + associated contact/membership/interaction/attendance data |
| **Actions** | Close · Set Sunday response · Record interaction · Add note · Convert to member · Mark "Not coming this Sunday" (exception) |
| **State changes** | `S.sundayResp`, `S.converted`, `S.exceptions`, `S.visits` |
| **Dependencies** | people, contacts, memberships, contact_interactions, service_expectations, service_attendance |
| **Production persistence required?** | Yes — all person data |
| **Authorization implications** | View: all. Edit contact details, record interaction: rep + leader. Convert: coordinator. |

**Sections:**
1. Header: avatar, name, type badge, cell/rep badge, expected-Sunday badge
2. Contact info: email, phone
3. **Contacts:** Service journey (visit 1/2/3 progress steps) + "Convert to member" at step 3
4. **Members:** Attendance pattern (8 dots) + "Not coming this Sunday" button if currently expected
5. Sunday Sep 20 response (Coming / Maybe / Not coming) — contacts only
6. Recent interactions timeline (type + note + date)
7. Notes (stub: "No notes yet.")

---

## 11 — Modals

| Modal | Trigger | Fields | Production impact |
|---|---|---|---|
| Quick add | Top bar button | Type (Contact/Member/Meeting/Event), Name/Title | Routes to appropriate create flow |
| Log contact | Outreach page, quick action | Name, phone/email, source, owner, notes | Creates person + contact record + initial interaction |
| Schedule meeting | Meetings page, quick action | Name, datetime, location | Creates meeting record |
| Create event | Events page, quick action | Name, datetime, location | Creates event record |
| Add person | People page | Name, type, phone/email | Creates person (+ contact or membership relationship) |
| Add person to service | Services page | Search, confirmation status | Creates service_expectation manually |
| Record exception | Services > Exceptions tab | Member select, reason | Creates one-service exception |
| Walk-in | Services > Check-in tab | Name, new/existing, phone | Creates person + contact + attendance record |
| Record interaction | Profile drawer | Type, notes, Sunday response | Creates contact_interaction; optionally updates service_expectation |
| New cell | Cells page | Cell name, leader | Creates cell record |

---

## 12 — Global Search

| Field | Value |
|---|---|
| **Scope** | PEOPLE array (all persons) |
| **Trigger** | 2+ characters typed in top bar |
| **Actions** | Click result → open profile drawer |
| **Production** | Full-text search on people (name, email, phone) |

---

## JavaScript State Inventory

All mutable client-side state that requires production persistence:

| State key | Type | Description | Production table |
|---|---|---|---|
| `S.sundayResp` | `{[personId]: 'confirmed'\|'maybe'\|'not-coming'\|null}` | Contact's response to current service | `service_expectations.response` |
| `S.checkedIn` | `Set<personId>` | People checked in at current service | `service_attendance` |
| `S.walkins` | `Array<{name, id}>` | Walk-in arrivals not in expected list | `people` + `service_attendance` |
| `S.exceptions` | `Set<personId>` | Members away this specific service | `service_expectations` (declined) or `service_exceptions` table |
| `S.exceptionReasons` | `{[personId]: string}` | Reason for exception | `service_expectations.reason` |
| `S.visits` | `{[personId]: number}` | Contact's attended service count | Derived from `service_attendance` |
| `S.converted` | `Set<personId>` | Contacts converted to member | `membership_transitions` + `memberships` |
| `S.peopleTab` | `'all'\|'member'\|'contact'` | Active filter tab on People page | UI only |
| `S.crmView` | `'table'\|'pipeline'` | Active view mode on CRM page | UI only / user preference |
| `S.svcTab` | string | Active Services sub-tab | UI only |
| `S.expFilter` | string | Active filter on Expected list | UI only |
| `S.currentService` | `'s1'\|'s2'...` | Selected service | URL / route param |
| `PEOPLE` | Array | All person records | `people` + `contacts` + `memberships` |
| `CELLS` | Array | All cell records | `cells` + `person_cell_relationships` |
| `SERVICES_HIST` | Array | Past service summaries | `services` + aggregated `service_attendance` |
