# Operational Workstream Shared Contracts

Cross-workstream migration contracts for the BLW York Hub operational feature set
(migrations 059–070). Each section records the owning workstream, the migration
number, and the key invariants other workstreams must not break.

---

## §1 Shared audience infrastructure (059)

**Migration 059** creates the `saved_groups`, `saved_group_members` and
`audience_specs` tables plus the `resolve_audience()` RPC. These are shared by
every other workstream that delivers targeted content.

- `audience_specs.mode` must be one of `all | cells | saved_groups | explicit`.
- `resolve_audience()` is SECURITY DEFINER, pinned `search_path`, and returns only
  active members. Callers must not join `saved_group_members` inline.
- Only admin/coordinator may manage `saved_groups` (no cell-leader writes).

---

## §2 Events audience extension (060)

**Migration 060** extends `events.audience` to include `cells | saved_groups |
explicit` and adds `audience_spec_id` FK.

- New audience modes require a non-null `audience_spec_id`.
- The constraint name is `events_new_audience_requires_spec`.

---

## §3 Meeting explicit-invitee read (061)

**Migration 061** allows explicit-meeting invitees to read the meeting row and
tightens `meeting_attendances_select_scoped` to gate non-invitee probing.

- The `meetings_select_visible` policy (via `can_view_meeting()` SECURITY DEFINER)
  is the canonical path for meeting visibility. Policies that query
  `meeting_attendances` directly from a meetings policy create RLS recursion —
  **do not add them** (migration 066 fixes the one 061 accidentally added).

---

## §4 Assignments (062)

**Migration 062** creates the `assignments` table for task delegation.

- Status lifecycle: `pending → in_progress → completed`; admin/coord may set
  `cancelled`.
- No DELETE policy. Deactivation is always `status = 'cancelled'`.
- `assigned_to` must be an active profile at INSERT time.
- `completed_at` is set by trigger on transition to `completed`.

---

## §5 Affirmation audience targeting (063)

**Migration 063** adds `audience_spec_id` to `confessions` and introduces the
`can_see_affirmation()` SECURITY DEFINER helper.

- `can_see_affirmation()` returns true for: (a) broadcast (null spec), (b)
  admin/coordinator, (c) the caller is in `resolve_audience(spec_id)`.
- `confessions_read` and `confession_declarations_write_own` both gate on
  `can_see_affirmation()`.
- `can_see_affirmation` is revoked from `public` and `anon`.

---

## §6 Announcements audience targeting (064)

**Migration 064** adds `audience_spec_id`, `is_active` and `published_at` to
`announcements`. Migration 068 supersedes the `announcements_manage` WITH CHECK
from 064 — see §10.

- Broadcast (`audience_spec_id IS NULL`) is visible to all active members.
- `is_active = false` hides an announcement from the read policy.

---

## §7 Audience grants and policy fixes (065)

**Migration 065** grants `INSERT, UPDATE, DELETE` on `saved_groups` and
`saved_group_members` to `authenticated`, and `INSERT` on `audience_specs`.
Also grants `service_role` full DML on `saved_groups`, `saved_group_members`,
`audience_specs` and `assignments`.

- Migration 070 extends `audience_specs_insert` to include cell leaders for their
  own cell; 065's grant is a prerequisite.

---

## §8 Meeting invitee read fix (066)

**Migration 066** fixes the RLS circular dependency introduced by 061 without
removing the policy.

- Introduces `is_meeting_invitee(uuid)` as SECURITY DEFINER to read
  `meeting_attendances` without triggering its own RLS.
- Rewrites `meetings_explicit_invitee_read` to use `is_meeting_invitee()`.
- `is_meeting_invitee` is revoked from `public` and `anon`.
- **Never drop `meetings_explicit_invitee_read`** — invited members depend on it
  to see `visibility = 'explicit'` meetings.

---

## §9 Trigger execute grant fix (067)

**Migration 067** revokes the default PUBLIC execute privilege from
`assignments_completed_at_stamp()`.

- Trigger functions need no direct-call grant; service_role is also revoked since
  the trigger fires on its own.

---

## §10 Audience resolution scope correction (068)

**Migration 068** splits `resolve_audience` into a complete resolver
(`resolve_audience_all`, service-role-only) and a caller-scoped wrapper that
returns at most the caller's own row for non-staff.

- `resolve_audience_all()` is revoked from `public`, `anon`, and `authenticated`.
- `resolve_audience()` for non-staff callers: single own-row result only, so RLS
  checks of `ra.profile_id = auth.uid()` (063, 064) remain exact.
- `saved_groups` and `saved_group_members` restricted to admin/coordinator reads.
- Cell leaders may **never** insert a broadcast announcement (`audience_spec_id IS
  NOT NULL` required in WITH CHECK on announcements).

---

## §11 Targeted messages (069)

**Migration 069** creates `communication_messages`, `communication_recipients`,
`communication_deliveries` and `communication_audit`.

- `send_message` and `preview_audience` both call `assert_can_send_message()`.
- External channels (`email`, `push`) are staff-only at the DB and dispatcher layer.
- Recipients are always resolved via `resolve_audience_all()` (068) — never the
  caller-scoped variant.
- The `dispatch-message` edge function claims rows via `claim_deliveries()` before
  any provider call.
- Cell leader authority is determined by `profiles.cell_id`, not arbitrary self-claim.

---

## §12 Cell-leader audience spec create (070)

**Migration 070** extends `audience_specs_insert` so cell leaders can create a
`cells`-mode spec naming exactly one cell they lead. This is required for the
announcement flow after 068's tightening.

- Guarded: `is_active_member()` + `mode = 'cells'` + `array_length(cell_ids, 1) = 1`
  + `c.leader_id = auth.uid()`.
- Cell leaders still cannot create broadcast, saved_groups, or explicit specs.
