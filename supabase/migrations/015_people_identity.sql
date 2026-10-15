-- ─── Migration 015: People Identity Layer ────────────────────────────────────
-- Introduces the unified `people` table as the stable human identity record.
-- This resolves the split-identity problem: contacts and members were previously
-- two separate identity systems with no shared primary key.
--
-- ONE HUMAN = ONE PERSON RECORD INVARIANT:
--   A person's people.id never changes when their ministry relationship changes.
--   Contact → Member conversion adds a memberships row; it does NOT create a
--   new people row.
--
-- What this migration adds:
--   1. public.people              — stable human identity
--   2. public.memberships         — ministry relationship records
--   3. public.membership_transitions — audit trail for relationship changes
--   4. contacts.person_id         — FK to people (backfilled, then NOT NULL)
--   5. profiles.person_id         — back-reference FK to people (backfilled)
--
-- What this migration does NOT change:
--   - auth.users               (untouched)
--   - profiles schema          (only person_id added)
--   - user_profiles            (untouched)
--   - Any existing CRM columns on contacts (untouched)
--   - Any existing RLS policies (all new policies are additive)

-- ─── 1. People table ─────────────────────────────────────────────────────────

create table if not exists public.people (
  id         uuid        primary key default gen_random_uuid(),
  full_name  text        not null check (char_length(full_name) >= 1),
  email      text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial unique constraints: multiple people may have NULL email/phone,
-- but non-null values must be unique across the table.
create unique index if not exists people_email_unique
  on public.people (email)
  where email is not null;

create unique index if not exists people_phone_unique
  on public.people (phone)
  where phone is not null;

drop trigger if exists people_updated_at on public.people;
create trigger people_updated_at
  before update on public.people
  for each row execute procedure public.set_updated_at();

alter table public.people enable row level security;

-- Authenticated users may read people records.
create policy "people_read" on public.people
  for select using (auth.role() = 'authenticated');

-- Insert: any authenticated user may create a person record (walk-in, contact logging).
create policy "people_insert" on public.people
  for insert with check (auth.role() = 'authenticated');

-- Update: only admins/coordinators may update a person's core identity.
create policy "people_update" on public.people
  for update using (public.is_core_admin())
  with check (public.is_core_admin());

-- Delete: admin only (merge/deduplicate workflow, admin-triggered).
create policy "people_delete" on public.people
  for delete using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'coordinator'
    )
  );

-- ─── 2. Memberships table ─────────────────────────────────────────────────────

create table if not exists public.memberships (
  id           uuid        primary key default gen_random_uuid(),
  person_id    uuid        not null references public.people(id) on delete restrict,
  joined_at    timestamptz not null default now(),
  role         text        not null default 'member'
                 check (role in ('member', 'cell_leader', 'admin', 'coordinator')),
  status       text        not null default 'active'
                 check (status in ('active', 'pending', 'inactive')),
  cell_id      uuid        references public.cells(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One active membership per person at a time
  constraint memberships_one_active unique (person_id, status)
    deferrable initially deferred
);

drop trigger if exists memberships_updated_at on public.memberships;
create trigger memberships_updated_at
  before update on public.memberships
  for each row execute procedure public.set_updated_at();

create index if not exists memberships_person_idx  on public.memberships (person_id);
create index if not exists memberships_status_idx  on public.memberships (status);

alter table public.memberships enable row level security;

create policy "memberships_read" on public.memberships
  for select using (auth.role() = 'authenticated');

create policy "memberships_insert" on public.memberships
  for insert with check (public.is_core_admin());

create policy "memberships_update" on public.memberships
  for update using (public.is_core_admin())
  with check (public.is_core_admin());

-- ─── 3. Membership transitions audit table ───────────────────────────────────

create table if not exists public.membership_transitions (
  id              uuid        primary key default gen_random_uuid(),
  person_id       uuid        not null references public.people(id) on delete restrict,
  from_type       text,
  to_type         text        not null,
  transitioned_at timestamptz not null default now(),
  performed_by    uuid        references public.profiles(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists membership_transitions_person_idx
  on public.membership_transitions (person_id);

alter table public.membership_transitions enable row level security;

create policy "membership_transitions_read" on public.membership_transitions
  for select using (public.is_core_admin());

create policy "membership_transitions_insert" on public.membership_transitions
  for insert with check (auth.role() = 'authenticated');

-- ─── 4. Add person_id to contacts ────────────────────────────────────────────

alter table public.contacts
  add column if not exists person_id uuid references public.people(id) on delete restrict;

create index if not exists contacts_person_idx on public.contacts (person_id);

-- ─── 5. Add person_id to profiles ────────────────────────────────────────────

alter table public.profiles
  add column if not exists person_id uuid references public.people(id) on delete set null;

alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('pending', 'active', 'rejected'));

create index if not exists profiles_person_idx on public.profiles (person_id);

-- ─── 6. Backfill: create people rows for existing profile (member) records ────

-- Each profiles row that hasn't been linked yet gets a people row.
-- We use a DO block to handle the loop safely.
do $$
declare
  r record;
  new_person_id uuid;
begin
  for r in
    select id, full_name, email, joined_at
    from public.profiles
    where person_id is null
  loop
    -- Check if a people row with this email already exists
    if r.email is not null then
      select id into new_person_id
      from public.people
      where email = r.email
      limit 1;
    else
      new_person_id := null;
    end if;

    if new_person_id is null then
      insert into public.people (full_name, email, created_at)
      values (coalesce(r.full_name, ''), r.email, coalesce(r.joined_at, now()))
      returning id into new_person_id;
    end if;

    update public.profiles
    set person_id = new_person_id
    where id = r.id;
  end loop;
end;
$$;

-- ─── 7. Backfill: link converted contacts to their member's person row ────────

-- Contacts with member_id set share the same human as that profile → reuse person_id.
update public.contacts c
set person_id = p.person_id
from public.profiles p
where c.member_id = p.id
  and c.person_id is null
  and p.person_id is not null;

-- ─── 8. Backfill: create people rows for remaining (non-member) contacts ──────

do $$
declare
  r record;
  new_person_id uuid;
begin
  for r in
    select id, contact_name, email, contact_phone, created_at
    from public.contacts
    where person_id is null
  loop
    new_person_id := null;

    -- Try to match by email first (avoids duplicate if email already in people)
    if r.email is not null then
      select id into new_person_id
      from public.people
      where email = r.email
      limit 1;
    end if;

    if new_person_id is null then
      insert into public.people (full_name, email, phone, created_at)
      values (r.contact_name, r.email, r.contact_phone, coalesce(r.created_at, now()))
      on conflict do nothing
      returning id into new_person_id;

      -- If on conflict hit, look up by email again
      if new_person_id is null and r.email is not null then
        select id into new_person_id
        from public.people
        where email = r.email
        limit 1;
      end if;

      -- Last resort: create without email constraint (duplicate names are fine)
      if new_person_id is null then
        insert into public.people (full_name, phone, created_at)
        values (r.contact_name, r.contact_phone, coalesce(r.created_at, now()))
        returning id into new_person_id;
      end if;
    end if;

    update public.contacts
    set person_id = new_person_id
    where id = r.id;
  end loop;
end;
$$;

-- ─── 9. Backfill: create people rows for any profiles still unlinked ──────────
-- (Handles edge case where profile email matched a contact that was just created)

do $$
declare
  r record;
  new_person_id uuid;
begin
  for r in
    select id, full_name, email, joined_at
    from public.profiles
    where person_id is null
  loop
    if r.email is not null then
      select id into new_person_id
      from public.people
      where email = r.email
      limit 1;
    else
      new_person_id := null;
    end if;

    if new_person_id is null then
      insert into public.people (full_name, email, created_at)
      values (coalesce(r.full_name, ''), r.email, coalesce(r.joined_at, now()))
      returning id into new_person_id;
    end if;

    update public.profiles
    set person_id = new_person_id
    where id = r.id;
  end loop;
end;
$$;

-- ─── 10. Backfill: create memberships rows from existing active profiles ───────

insert into public.memberships (person_id, joined_at, role, status, cell_id)
select
  pr.person_id,
  pr.joined_at,
  pr.role,
  coalesce(pr.status, 'active'),
  pr.cell_id
from public.profiles pr
where pr.person_id is not null
  and not exists (
    select 1 from public.memberships m
    where m.person_id = pr.person_id
  )
on conflict do nothing;

-- ─── 11. Enforce NOT NULL on contacts.person_id ───────────────────────────────
-- Only safe once every contacts row has been backfilled above.

do $$
declare
  unlinked_count integer;
begin
  select count(*) into unlinked_count
  from public.contacts
  where person_id is null;

  if unlinked_count > 0 then
    raise exception
      'Cannot enforce contacts.person_id NOT NULL: % rows still unlinked. '
      'Check backfill steps 7-8 above.',
      unlinked_count;
  end if;
end;
$$;

alter table public.contacts
  alter column person_id set not null;
