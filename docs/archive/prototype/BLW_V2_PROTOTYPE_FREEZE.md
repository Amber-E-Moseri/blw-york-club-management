# BLW York Hub v2 — Prototype Freeze

**Prototype status: FROZEN**

**Reference file:** `BLW_York_Hub_v2.html`
**Frozen date:** September 15, 2026
**Branch:** `feat/prototype-ui-integration`

---

## What This Document Declares

`BLW_York_Hub_v2.html` is the authoritative product and interaction reference for the subsequent React + Supabase implementation. It defines:

- Information architecture (9 primary destinations)
- Visual design system (tokens, typography, component patterns)
- Interaction patterns (navigation, drawers, modals, check-in, response buttons)
- Feature scope for each page
- The ministry operating model the product encodes

**Do not redesign the prototype. Do not add speculative features to it. If you need to understand how something should look or behave, open the prototype.**

---

## Prototype Scope

The prototype demonstrates the following fully:

- Dashboard aggregation view
- People directory (All / Members / Contacts tabs, profile drawer)
- Outreach CRM (table + pipeline views, Sunday response buttons)
- Services workspace:
  - Expected list with "Why expected" column
  - Check-in tab with walk-in entry
  - Exceptions tab (one-service away)
  - After Service derived queue
  - History tab
- Cells grid with leader and integrating contacts
- Meetings hub (layout reference only)
- Events calendar (layout reference only)
- Growth hub (layout reference only)
- Admin centre (layout reference only)
- Profile drawer (contacts and members)
- All modal forms
- Global search
- Mobile layout (bottom nav, responsive grid)

---

## Intentionally Simulated Behavior

The following behaviors are simulated for demo purposes and do not represent production implementation:

| Behavior | Simulation | Production |
|---|---|---|
| People data | 7 contacts + 7 members hardcoded in `PEOPLE` array | Supabase `people`, `contacts`, `memberships` tables |
| Attendance pattern | `pat:[1,1,0,...]` array on person object | Derived from `service_attendance` lookback query |
| Visit count | `S.visits` mutable JS object, pre-seeded from `p.visits` | `COUNT(service_attendance)` per contact per service type |
| Sunday response | `S.sundayResp` map, mutated on button click | `service_expectations.response` in database |
| Check-in | `S.checkedIn` Set | `service_attendance` rows |
| Exceptions | `S.exceptions` Set | `service_expectations.response = 'declined'` for that service |
| Membership conversion | `p.type = 'member'` mutation | Insert `memberships` + `membership_transitions` rows |
| Walk-ins | `S.walkins` array with synthetic ids | `people` + `contacts` + `service_attendance.is_walk_in = true` |
| Dashboard stats | Partially hardcoded (63 expected) | All derived from database queries |
| Meetings, Events, Growth, Admin | Layout reference only; all interactions are `showToast()` stubs | Full CRUD + business logic per entity |
| Service history | `SERVICES_HIST` static array | `services` + `service_attendance` aggregate queries |
| Regular attendance threshold | `sum(pat) >= 5` of 8 | `attendance_pattern_snapshots` with configurable threshold |
| Explanation text | Computed fresh on every render | Snapshotted into `service_expectations.explanation` at generation time |

---

## Prototype Bugs Fixed Before Freeze

Two bugs were identified in the gap audit and fixed prior to freezing:

### Fix 1 — Check-in double-increment (CI-1)

**File:** `BLW_York_Hub_v2.html` · `toggleCheckin()` function

**Problem:** Unchecking and re-checking a contact incremented `S.visits` twice, potentially misrepresenting visit count.

**Fix:** Added `S.visits[id] = Math.max(0,(S.visits[id]||0)-1)` on uncheck. Visit count now correctly tracks net check-in state within the session.

### Fix 2 — Dead "Convert to member" branch for members (S-2)

**File:** `BLW_York_Hub_v2.html` · `renderExpected()` function

**Problem:** Dead code block (`if(!isContact&&S.visits&&S.visits[p.id]>=3...)`) would never fire in the prototype but would confuse implementors — it incorrectly placed a "Convert to member" button on regular members rather than contacts.

**Fix:** Removed the dead block. Check-in button now renders uniformly for all expected people. The "Convert to member" action remains correctly placed in the profile drawer for contacts with 3+ visits.

---

## What Is Not In Scope for the Prototype

The prototype deliberately does not demonstrate:

- Authentication and authorization (login, role enforcement)
- Row-level data security
- Email notifications
- Meeting agendas, minutes, and action items
- Event RSVP management
- Cell detail pages (member list, integration states)
- Growth habit logging (beyond layout)
- Admin approval workflow (beyond layout)
- Service configuration UI (beyond caption text)
- Duplicate person detection
- Person merge workflow
- Audit log UI
- Reports and exports
- Historical attendance correction UI
- Multi-service context switching (CRM always shows Sep 20)
- Online attendance mode
- "My Contacts" filtered view (exists as a conceptual description only)

These are all documented in:
- `docs/blw-data-model.md`
- `docs/blw-state-authority.md`
- `docs/blw-authorization-matrix.md`
- `docs/blw-react-migration-plan.md`

---

## Next Step

The next step is implementation Branch 1 as defined in `docs/blw-react-migration-plan.md`:

**Branch 1 — Core schema + person identity**

Do not begin React migration in this branch. This branch's purpose was to close the prototype architecture. It is complete.
