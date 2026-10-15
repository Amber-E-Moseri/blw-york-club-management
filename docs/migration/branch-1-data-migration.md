# Branch 1 — Data Migration Plan

> Companion to `015_people_identity.sql`.
> Describes the backfill strategy, rollback plan, and verification steps.

---

## What Migration 015 Does

`015_people_identity.sql` is a **single transaction** that:

1. Creates `people`, `memberships`, `membership_transitions` tables
2. Adds `contacts.person_id` (nullable initially) and `profiles.person_id` (nullable)
3. Backfills `people` rows from existing `profiles` rows
4. Links converted contacts (`is_member = true, member_id IS NOT NULL`) to their existing `people` row
5. Creates `people` rows for remaining contacts and links them
6. Backfills `memberships` rows from existing `profiles` rows
7. Enforces `contacts.person_id NOT NULL` — will fail and roll back if any contact is still unlinked

---

## Backfill Strategy

### Step A — Profiles → People (migration step 6)

For each `profiles` row:
- If `email` matches an existing `people.email`: link to that row (idempotent re-run safety)
- If no match: create a new `people` row with `full_name = profiles.full_name`, `email = profiles.email`

**Result:** Every `profiles` row gets a `person_id`.

### Step B — Converted contacts (migration step 7)

For each `contacts` row where `member_id IS NOT NULL`:
- Set `contacts.person_id = profiles.person_id` for the linked member profile

**Result:** A contact who was converted to a member shares the same `people` record as their `profiles` row. The ONE HUMAN = ONE PERSON RECORD invariant is retroactively satisfied.

### Step C — Non-member contacts (migration step 8)

For each `contacts` row where `person_id IS NULL` (not yet linked):
1. If `email` is set, check `people` for a row with that email → reuse it
2. Otherwise, insert a new `people` row

**Note:** Email deduplication in this step may silently merge a contact and a profile that share an email but may be different people (e.g., a contact logged under an existing member's email by mistake). If this is a concern, run the deduplication query below before applying this migration.

### Step D — Membership backfill (migration step 10)

For each `profiles` row that has a `person_id`:
- Insert a `memberships` row with `role = profiles.role`, `status = profiles.status ?? 'active'`
- Skip if a `memberships` row for that person already exists

---

## Pre-migration Checks

Run these queries before applying the migration:

```sql
-- How many profiles have email set?
select count(*) from public.profiles where email is not null;

-- How many contacts have email set?
select count(*) from public.contacts where email is not null;

-- Contacts with email that matches an existing profile email (potential merge)
select c.id, c.contact_name, c.email, p.full_name as profile_name
from public.contacts c
join public.profiles p on p.email = c.email
where c.is_member = false
  and c.email is not null;

-- Contacts that have is_member=true but no member_id (incomplete bridge)
select count(*) from public.contacts
where is_member = true and member_id is null;
```

If the third query returns rows, review them. The migration will create separate `people` records for these contacts (not merged with the matching profile). If they should be the same person, you can merge after the migration using the future "Merge people" workflow.

---

## Rollback Plan

Migration 015 is written as a DDL + DML transaction. To roll back:

```sql
-- Remove NOT NULL constraint first
alter table public.contacts alter column person_id drop not null;

-- Remove new columns from existing tables
alter table public.contacts drop column if exists person_id;
alter table public.profiles drop column if exists person_id;

-- Drop new tables (order matters due to FKs)
drop table if exists public.membership_transitions;
drop table if exists public.memberships;
drop table if exists public.people;
```

**Safe to run:** dropping these tables does not affect `profiles`, `contacts`, or any existing application code.

---

## Post-migration Verification

After applying the migration:

```sql
-- 1. Every contact must have person_id set
select count(*) from public.contacts where person_id is null;
-- Expected: 0

-- 2. Every profile must have person_id set
select count(*) from public.profiles where person_id is null;
-- Expected: 0

-- 3. Every person_id on contacts must exist in people
select count(*) from public.contacts c
left join public.people p on p.id = c.person_id
where p.id is null;
-- Expected: 0

-- 4. Every person_id on profiles must exist in people
select count(*) from public.profiles pr
left join public.people p on p.id = pr.person_id
where p.id is null;
-- Expected: 0

-- 5. Converted contacts (is_member=true, member_id set) share person_id with profile
select count(*) from public.contacts c
join public.profiles pr on pr.id = c.member_id
where c.is_member = true
  and c.member_id is not null
  and c.person_id != pr.person_id;
-- Expected: 0  (invariant: same human = same person_id)

-- 6. One memberships row per profile person
select p.id, count(m.id) as membership_count
from public.people p
join public.profiles pr on pr.person_id = p.id
left join public.memberships m on m.person_id = p.id
group by p.id
having count(m.id) != 1;
-- Expected: 0 rows
```

---

## Going Forward: NEW Code Paths

After this migration:

| Operation | OLD path | NEW path (Branch 1+) |
|---|---|---|
| Log new contact | Insert into `contacts` with `contact_name`, `contact_phone` | `createContactPerson()`: creates `people` + `contacts`, links via `person_id` |
| Convert to member | Set `contacts.is_member=true`, set `contacts.member_id` | `establishMembership()`: inserts `memberships` + `membership_transitions` row |
| Look up person | Query `profiles` or `contacts` by their own ID | Query `people` by `people.id` |

The OLD paths continue to work (no breaking changes). The NEW paths must be used for all code written after Branch 1.

---

## Compatibility Boundary

| What changed | Impact on existing code |
|---|---|
| `contacts.person_id` added (NOT NULL) | Existing `INSERT INTO contacts` queries that don't include `person_id` will fail — these must be updated to use `createContactPerson()` or include a `person_id` |
| `profiles.person_id` added (nullable) | No impact — existing queries ignore unknown columns |
| New tables (`people`, `memberships`, `membership_transitions`) | No impact — existing code doesn't reference them |

**Action required:** Any place in the codebase that does `INSERT INTO contacts` directly (currently `src/lib/queries/contacts.ts:createContact()`) must be updated to either:
1. Call `createContactPerson()` (preferred — enforces the invariant), or
2. Accept a `person_id` parameter and pass it through

This is a **non-breaking change** at the database level (existing rows are backfilled). But new inserts via old paths will be rejected by the NOT NULL constraint.

---

## Branch 1 Scope Boundary

Branch 1 does NOT:
- Migrate `src/lib/queries/contacts.ts:createContact()` to call `createContactPerson()` — that is Branch 2 scope
- Remove `contacts.contact_name`, `contacts.contact_phone`, `contacts.is_member`, `contacts.member_id` — kept for backward compat
- Change any existing React component to use `Person` types — that is Branch 3+ scope
- Add Supabase Edge Functions for person services — that is Branch 4+ scope
