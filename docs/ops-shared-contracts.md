# BLW York Hub — Operational Shared Contracts
## Integration branch: `ops/blwyork-operational` (base: 53ef639 / migration 058)

> This document is the authoritative contract for all five operational workstreams.
> Every feature agent must review the relevant sections before touching the database.
> Do not deviate without updating this document and getting integration-owner sign-off.

---

## 1. Audience Modes

All audience-aware features (events, announcements, messages, assignments, affirmations)
use one of four targeting modes:

| Mode | `audience` value | Meaning |
|---|---|---|
| Everyone | `'all'` | All active members |
| Cells | `'cells'` | Members whose `profiles.cell_id` is in an explicit cell list |
| Saved groups | `'saved_groups'` | Members in one or more named saved groups |
| Specific members | `'explicit'` | An explicit list of profile IDs |

> **Extension of migration 038.** The existing `events.audience` only supports `'all'` and `'meeting'`.
> Migration 059 extends this enum across the system. Do not add new audience columns to individual tables —
> use the shared `audience_specs` table defined in §2.

---

## 2. Audience Representation

### 2a. `audience_specs` table (migration 059)

A single shared table stores audience intent for any content type:

```sql
public.audience_specs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode         text NOT NULL CHECK (mode IN ('all','cells','saved_groups','explicit')),
  cell_ids     uuid[],   -- non-null when mode = 'cells'; refs public.cells(id)
  group_ids    uuid[],   -- non-null when mode = 'saved_groups'; refs public.saved_groups(id)
  profile_ids  uuid[],   -- non-null when mode = 'explicit'; refs public.profiles(id)
  created_by   uuid NOT NULL REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
)
```

Content tables reference it via `audience_spec_id uuid REFERENCES public.audience_specs(id)`.
This replaces the inline `audience` + `audience_meeting_id` columns for new content types.

**Events** keep their existing `audience` column (backward compat) until migration 060 migrates them
to use `audience_spec_id`. Until then the two systems coexist.

### 2b. `saved_groups` table (migration 059)

```sql
public.saved_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) >= 1),
  description text,
  created_by  uuid NOT NULL REFERENCES public.profiles(id),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
)

public.saved_group_members (
  group_id    uuid NOT NULL REFERENCES public.saved_groups(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by    uuid NOT NULL REFERENCES public.profiles(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, profile_id)
)
```

---

## 3. Recipient Resolution

### 3a. `resolve_audience(p_spec_id uuid)` RPC (migration 059)

Returns the set of `profile_id` values that match the audience spec, filtered to active members only:

```sql
-- Returns: TABLE(profile_id uuid)
-- security definer, search_path = public, pg_temp
-- Mode 'all':          all profiles where status = 'active'
-- Mode 'cells':        profiles where status = 'active' AND cell_id = ANY(spec.cell_ids)
-- Mode 'saved_groups': profiles active AND in any saved_group_members row for any group_id in spec.group_ids
-- Mode 'explicit':     spec.profile_ids filtered to status = 'active'
```

All callers use this function — never inline the logic in edge functions or API routes.

### 3b. Active-member eligibility

A profile is eligible to receive content if and only if:

```sql
profiles.status = 'active'
```

The existing `is_active_profile(p_user uuid)` helper (migration 036) codifies this.
`is_active_member()` (migration 022) checks the calling user. Both are `security definer`.

**Pending and rejected members receive nothing.** They are invisible to audience resolution.
Inactive members also receive nothing.

---

## 4. Snapshot vs Dynamic Membership

| Content type | Membership model | Rationale |
|---|---|---|
| Announcements | **Snapshot** — captured at publish time via `resolve_audience` | A past announcement was sent to a fixed set |
| Messages | **Snapshot** — captured at send time | Delivery is a one-time event |
| Assignments | **Snapshot** — captured at assignment time | Assignees are fixed; they own the record |
| Affirmations | **Snapshot** — captured at distribution time | Distribution is a one-time targeted send |
| Meeting invitations | **Dynamic** — `meeting_attendances` is the live invitation list | Leaders may add/remove attendees until meeting occurs |
| Events (audience='cells') | **Dynamic** — re-resolved at notify time | Cell membership changes before notification fires |

---

## 5. Meeting Invitation and Attendance Model

The existing `meetings.visibility` enum includes `'explicit'` (already in migration 009).
`meeting_attendances` serves as the explicit invitation list for private meetings.

### Rules

- `visibility = 'public'` — any authenticated user can see and join.
- `visibility = 'leaders'` — only `role IN ('cell_leader','admin','coordinator')`.
- `visibility = 'cell'` — members whose `profiles.cell_id = meetings.cell_id`.
- `visibility = 'explicit'` — only users who have a row in `meeting_attendances` for this meeting
  (plus admins/coordinators for operational access).

### RLS gap to close (migration 061)

The current `meeting_attendances` policies do not restrict SELECT for `visibility = 'explicit'`.
Migration 061 adds:

```sql
-- A user may see a meeting_attendances row if:
--   they are the attendee (user_id = auth.uid())
--   OR the meeting is not 'explicit'
--   OR they are admin/coordinator
```

**Test requirement**: A member not in `meeting_attendances` for an `explicit` meeting
cannot SELECT that meeting row or its attendance rows.

---

## 6. Assignment Status and Ownership Model

### `assignments` table (migration 062)

```sql
public.assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL CHECK (char_length(title) >= 1),
  description   text,
  assigned_to   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by   uuid NOT NULL REFERENCES public.profiles(id),
  due_date      date,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','completed','cancelled')),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
)
```

### Ownership rules

- **Create**: admin, coordinator, cell_leader (leader may only assign to their own cell's members).
- **Update status**: assignee (`assigned_to`) may advance `pending → in_progress → completed`.
  Admin/coordinator may set any status including `cancelled`.
- **Read**: assignee sees their own. Admin/coordinator sees all. Cell leader sees their cell's members'.
- **Delete**: not allowed — set `status = 'cancelled'` instead.

---

## 7. Affirmation Distribution vs Declaration Tracking

Existing tables: `confessions` (display name: Affirmations), `confession_declarations`.

### Distribution (new in migration 063)

Currently `confessions` is a broadcast — all active members see it.
Migration 063 adds `audience_spec_id` to `confessions`:

```sql
ALTER TABLE public.confessions
  ADD COLUMN audience_spec_id uuid REFERENCES public.audience_specs(id);
-- NULL = legacy broadcast (all active). Non-null = targeted distribution.
```

RLS update: `confessions_read` adds check against `resolve_audience(audience_spec_id)`
when `audience_spec_id IS NOT NULL`.

### Declaration tracking (existing, unchanged)

`confession_declarations` tracks who has declared a specific affirmation.
Privacy: `declaration_identity_privacy` (migration 052) — declaration count is public,
but individual declarer identity is visible only to the declarer themselves and admin/coordinator.
**Never expose declaration identity to cell leaders or other members.**

---

## 8. Permission Matrix (Extended)

Extends `docs/blw-authorization-matrix.md` for the new operational capabilities.

| Capability | Admin | Coordinator | Cell Leader | Member |
|---|---|---|---|---|
| Create saved group | ✓ | ✓ | ✗ | ✗ |
| Manage saved group members | ✓ | ✓ | ✗ | ✗ |
| Send announcement (all) | ✓ | ✓ | ✗ | ✗ |
| Send announcement (cells) | ✓ | ✓ | Own cell | ✗ |
| Send message (any audience) | ✓ | ✓ | ✗ | ✗ |
| Create assignment | ✓ | ✓ | Own cell | ✗ |
| Update own assignment status | ✓ | ✓ | ✓ | ✓ |
| Cancel assignment | ✓ | ✓ | ✗ | ✗ |
| Distribute affirmation (targeted) | ✓ | ✓ | ✗ | ✗ |
| Create private meeting (explicit) | ✓ | ✓ | ✓ | ✗ |
| Add member to explicit meeting | ✓ | ✓ | Cell (own) | ✗ |
| Transfer member between cells | ✓ | ✓ | ✗ | ✗ |

---

## 9. Migration Ownership and Ordering

Migrations must be forward-only with unique numbers. Do not alter or reorder migrations ≤ 058.

| # | Owner workstream | Scope |
|---|---|---|
| 059 | Shared audience | `audience_specs`, `saved_groups`, `saved_group_members`, `resolve_audience()` RPC |
| 060 | Shared audience | Extend `events` to support `audience_spec_id`; back-migrate existing `audience='meeting'` rows |
| 061 | Meetings/attendance | RLS fix for `explicit` meeting visibility; `meeting_invitations` helper function |
| 062 | Assignments | `assignments` table, RLS, status-transition trigger |
| 063 | Affirmations | `confessions.audience_spec_id`, updated RLS |
| 064 | Announcements | `announcements.audience_spec_id`, updated RLS |

Each migration file must:
- Open with a comment block naming its number, owner workstream, and dependencies.
- Be idempotent (`IF NOT EXISTS`, `OR REPLACE`, `IF EXISTS` on drops).
- Include RLS immediately after each table.
- Grant `execute` on any new function to `authenticated` (and `service_role` if security definer).
- Not re-create or modify any object owned by migrations ≤ 058 except where explicitly noted.

---

## 10. E2E Certification Scenarios (Phase 4)

The following scenarios must pass on an isolated local Supabase stack with real authenticated roles:

| # | Scenario | Success condition |
|---|---|---|
| E2E-01 | Create a cell and assign a leader | Cell exists, `cells.leader_id` set, leader can see cell |
| E2E-02 | Add and transfer members | Member in cell-A, reassign to cell-B, old leader no longer sees them |
| E2E-03 | Create a fellowship-wide event | Event with `audience='all'`, all active members notified |
| E2E-04 | Create a private meeting for selected members | `visibility='explicit'`, attendees list populated |
| E2E-05 | Verify excluded members cannot access meeting data | Non-invitee SELECT returns no rows |
| E2E-06 | Send announcement to all active members | All active profiles appear in delivery snapshot |
| E2E-07 | Send message to specific individuals | Only named profiles in `audience_specs.profile_ids` receive it |
| E2E-08 | Send message to a saved group | Group members receive, non-members do not |
| E2E-09 | Assign unique tasks to different members | Two distinct `assignments` rows, different `assigned_to` |
| E2E-10 | Verify independent assignment completion | Member A completes theirs; Member B's status unchanged |
| E2E-11 | Distribute targeted affirmations | Non-audience member cannot SELECT the affirmation |
| E2E-12 | Preserve declaration identity privacy | Staff sees count, cannot see who declared (not own row) |
| E2E-13 | Verify notifications and attendance | `meeting_attendances.attended` update reflected; push log row present |
| E2E-14 | Verify pending member isolation | Pending profile NOT returned by `resolve_audience` for any mode |
| E2E-15 | Verify rejected member isolation | Rejected profile NOT returned by `resolve_audience` for any mode |

Both positive (access granted) and negative (access denied) checks are required for E2E-05, E2E-11, E2E-14, E2E-15.

---

*Last updated: 2026-10-13 by integration agent. Base: ops/blwyork-operational @ 53ef639.*
