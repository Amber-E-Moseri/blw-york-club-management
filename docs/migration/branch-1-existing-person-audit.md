# Branch 1 — Existing Person Audit

> Audit of the current identity architecture before any schema changes.
> Produced as Phase 0 of BLW YORK HUB — REACT MIGRATION / BRANCH 1.

---

## The Split-Identity Problem

The codebase has **two separate identity systems** with no unified person record:

| System | Table | PK ties to | Can exist without auth? |
|---|---|---|---|
| Member identity | `public.profiles` | `auth.users.id` | No — trigger auto-creates on signup |
| Extended member profile | `public.user_profiles` | `auth.users.id` | No — auth-linked by FK |
| Outreach contact identity | `public.contacts` | `gen_random_uuid()` | Yes — standalone |

There is **no `public.people` table**. A person who starts as a contact and later becomes a member cannot preserve the same identity record — they exist in `contacts` with standalone name/phone/email fields, and membership requires a new `auth.users` row, creating a new `profiles` row with a different UUID.

---

## Existing Tables (Identity-Relevant)

### `public.profiles` (migration 000)

```sql
id         uuid primary key  -- = auth.users.id (set by handle_new_user trigger)
email      text unique
full_name  text
role       text  -- 'coordinator' | 'admin' | 'cell_leader' | 'member'
status     text  -- 'pending' | 'active' | 'rejected' (managed by approvePendingMember)
cell_id    uuid references cells(id)
admin_role text
avatar_url text
joined_at  timestamptz
updated_at timestamptz
```

**Critical constraint:** `id = auth.users.id`. No profile can exist without an auth account.
A `handle_new_user` trigger populates this from `auth.users.raw_user_meta_data`.

### `public.user_profiles` (migration 001)

```sql
user_id        uuid primary key references auth.users(id) on delete cascade
first_name     text
last_name      text
phone          text
avatar_url     text
bio            text
student_number text
created_at     timestamptz
updated_at     timestamptz
```

Also auth-linked. Extends `profiles` with structured name fields. The `useUserProfile` hook joins these two tables; falls back to `profiles` alone if `user_profiles` row doesn't exist.

### `public.contacts` (migration 005 + 007 + 011)

```sql
id               uuid primary key default gen_random_uuid()
contact_name     text not null   -- standalone identity: name NOT linked to people
contact_phone    text            -- standalone identity: phone NOT linked to people
email            text            -- added in migration 007; no unique constraint
is_member        boolean default false
member_id        uuid references profiles(id)  -- attempted bridge: contact → member
logged_by        uuid not null references profiles(id)
follow_up_assignee uuid references profiles(id)
cell_id          uuid references cells(id)
archived         boolean default false
-- ... other CRM fields
```

**Split identity evidence:**
- `contacts.contact_name` is a raw text field — not a FK to any person record
- `contacts.member_id → profiles(id)` is a one-way bridge added when a contact converts, but does NOT prevent the creation of a separate `profiles` row with a new UUID
- The conversion path (`convertMember()` in prototype) would: create auth user → create profiles row → set `contacts.is_member=true, contacts.member_id=<new profiles.id>`. The `profiles.id` is a new UUID distinct from `contacts.id`.
- `contacts` rows are NEVER deleted on conversion (intended, per data model spec)

---

## Identity Violation: ONE HUMAN = ONE PERSON RECORD

The current architecture **violates the invariant** in two ways:

### Violation 1: A contact who becomes a member gets a new UUID

Current flow:
1. Rep logs contact → `contacts` row created, `id = uuid-A`
2. Contact joins → new auth account created → `profiles` row created, `id = uuid-B` (= auth.users.id)
3. `contacts.is_member = true`, `contacts.member_id = uuid-B`

Result: The same human now has **two separate primary keys** (`uuid-A` in contacts, `uuid-B` in profiles). Attendance records would need to decide which to reference.

### Violation 2: There is no stable person identity across ministry relationship changes

`contacts.id` is stable for the contact phase. `profiles.id` (= auth id) is stable for the member phase. But they are different UUIDs. Any foreign key in another table (attendance, interactions, follow-ups) that references `contacts.id` becomes orphaned at conversion time without explicit migration.

---

## Existing Attempted Bridge

`contacts.member_id uuid references profiles(id)` is a **post-hoc link** (added in migration 005) intended to say "this contact is now this member." This solves the display problem (show them in the Members tab) but does NOT solve the identity problem:

- It is nullable (contacts who haven't converted have no `member_id`)
- There is no corresponding back-reference from `profiles` to `contacts`
- `is_member` boolean can be set without a valid `member_id` (no constraint enforces them together)
- Attendance records still don't know which UUID to use for "this person"

---

## All Tables That Reference `profiles.id`

Every existing relation points to the auth-linked `profiles` table. None point to a unified person identity:

| Table | Column | Purpose |
|---|---|---|
| `user_profiles` | `user_id` | Extended profile for auth user |
| `cells` | `leader_id` | Cell leader is a member |
| `contacts` | `logged_by` | Rep who logged the contact |
| `contacts` | `follow_up_assignee` | Follow-up owner |
| `contacts` | `member_id` | Post-hoc bridge on conversion |
| `contact_tags` | `tagged_by` | Who tagged the contact |
| `contact_follow_ups` | `assigned_to`, `assigned_by` | Follow-up assignment |
| `contact_audit_log` | `changed_by` | Who made the change |
| `admin_role_assignments` | (FK in migration 004) | Admin role holder |
| `weekly_messages` | `author_id` | Message author |
| `monthly_devotionals` | `created_by` | Devotional author |
| `attendance_imports` | `imported_by` | Import actor |

**Branch 1 scope:** None of these tables are modified. They continue to reference `profiles.id`. Only `contacts` gets a new `person_id` FK added.

---

## Existing TypeScript Types

### `User` (`src/types/index.ts`)
Maps to `profiles` table. Fields: id, email, full_name, avatar_url, role, joined_at, cell_id.

### `Member` (`src/types/index.ts`)
Maps to `profiles JOIN user_profiles`. Fields: id, full_name, email, role, phone, student_number, cell_id.

### `Contact` (`src/types/index.ts`)
Maps to `contacts` table. Fields: id, contact_name, contact_phone, email, is_member, member_id (as string), etc.

**Branch 1 adds:** `Person`, `ContactRelationship`, `MembershipRelationship`, `PersonSummary`.

---

## Current Query Patterns (Affected by Branch 1)

### `fetchMembersFiltered()` (`src/lib/queries/members.ts`)
Queries `profiles` directly. **Not changed in Branch 1** — members are still backed by `profiles`.

### `approvePendingMember()` (`src/lib/queries/members.ts`)
Updates `profiles.status`. **Not changed in Branch 1** — approval workflow stays on profiles.

### `createContact()` (`src/lib/queries/contacts.ts`)
Inserts into `contacts` with inline `contact_name`, `contact_phone`. **Branch 1 adds:** must also insert into `people` and set `contacts.person_id` on new contacts created after migration.

### `useUserProfile()` hook (`src/hooks/useUserProfile.ts`)
Queries `user_profiles JOIN profiles`. **Not changed in Branch 1** — hook stays on the auth-linked profile system.

---

## Migration Strategy

Branch 1 introduces `people` as a **new identity layer alongside** the existing system. It does NOT replace or modify `profiles`, `user_profiles`, or any auth plumbing.

### What's added

1. **`public.people` table** — stable UUID per human, not tied to auth
2. **`public.memberships` table** — ministry relationship records per person
3. **`public.membership_transitions` table** — audit trail for relationship changes
4. **`contacts.person_id uuid NOT NULL references people(id)`** — added and backfilled
5. **`profiles.person_id uuid references people(id)`** — added and backfilled

### What's NOT changed

- `auth.users` — untouched
- `profiles` — no existing columns modified; only `person_id` added
- `user_profiles` — untouched
- All existing contact CRM fields — untouched
- All existing RLS policies — untouched; new policies are additive
- All existing application code paths — no breaking changes

### Backfill logic

```
For each existing profiles row:
  → INSERT into people (full_name, email)
  → UPDATE profiles SET person_id = new people.id

For each existing contacts row where member_id IS NOT NULL:
  → contacts.person_id = profiles.person_id (re-use the member's person row)

For each existing contacts row where member_id IS NULL:
  → INSERT into people (full_name = contact_name, email)
  → UPDATE contacts SET person_id = new people.id
```

Edge cases:
- Contact email matches a profiles email: in Branch 1, we do NOT automatically merge — they remain separate people records. A future "Merge people" workflow (Branch 2) handles deduplication.
- Contact with `is_member = true` but `member_id IS NULL`: treat as unmapped contact → create new people row.

### Compatibility boundary

All existing application code that reads/writes `profiles` or `contacts` continues to work. No existing query is broken. New services (`createPerson`, `createContactPerson`, `establishMembership`) operate on `people` + `memberships` for net-new operations.

---

## Summary of Findings

| Finding | Severity | Resolution |
|---|---|---|
| No `people` table — two separate identity systems | Critical | Branch 1 adds `people` table |
| `contacts` identity fields are standalone text, not FKs | Critical | Branch 1 adds `contacts.person_id` |
| `contacts.member_id` bridge does not prevent UUID duplication | High | `memberships` table replaces this pattern going forward |
| `profiles.id = auth.users.id` — cannot be a stable person key | Known constraint | `profiles.person_id` added as back-reference; `people.id` is the stable key |
| No unique constraint on `contacts.email` | Medium | `people.email` has partial unique constraint; contacts inherit through `person_id` |
| No audit trail for membership status changes | Medium | `membership_transitions` table added |
| `is_member + member_id` bridge not constrained together | Low | Deprecated pattern; `memberships` table is the authority going forward |

---

**Audit complete. Schema changes may now begin.**
