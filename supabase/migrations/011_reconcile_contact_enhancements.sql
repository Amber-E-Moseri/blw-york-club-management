-- ─── Migration 011: Reconcile contact enhancements ───────────────────────────
-- The original 006_contact_enhancements.sql was committed but never applied
-- to the remote database (blocked by duplicate-006 numbering collision).
-- This migration applies all additions from that file idempotently.
--
-- APPLY VIA: Supabase Studio → SQL Editor
--   https://supabase.com/dashboard/project/hecropqaidcveeoagsgy/sql/new

-- ─── New columns on contacts ─────────────────────────────────────────────────

alter table public.contacts
  add column if not exists follow_up_assignee uuid
    references public.profiles(id) on delete set null,
  add column if not exists email text;

-- ─── contact_tags ─────────────────────────────────────────────────────────────

create table if not exists public.contact_tags (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  tag_name    text not null,
  tag_color   text not null default '#cccccc',
  tagged_on   date not null default current_date,
  tag_notes   text,
  tagged_by   uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);

create index if not exists contact_tags_contact_idx
  on public.contact_tags(contact_id);

alter table public.contact_tags enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='contact_tags' and policyname='contact_tags_read'
  ) then
    create policy "contact_tags_read" on public.contact_tags
      for select using (
        is_core_admin()
        or exists (
          select 1 from public.contacts c
          where c.id = contact_tags.contact_id
            and (is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid())
        )
      );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='contact_tags' and policyname='contact_tags_insert'
  ) then
    create policy "contact_tags_insert" on public.contact_tags
      for insert with check (
        is_core_admin()
        or exists (
          select 1 from public.contacts c
          where c.id = contact_tags.contact_id
            and (is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid())
        )
      );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='contact_tags' and policyname='contact_tags_delete'
  ) then
    create policy "contact_tags_delete" on public.contact_tags
      for delete using (
        is_core_admin()
        or exists (
          select 1 from public.contacts c
          where c.id = contact_tags.contact_id
            and (is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid())
        )
      );
  end if;
end $$;

-- ─── contact_follow_ups ───────────────────────────────────────────────────────

create table if not exists public.contact_follow_ups (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  assigned_to  uuid not null references public.profiles(id) on delete restrict,
  assigned_by  uuid not null references public.profiles(id) on delete restrict,
  assigned_on  timestamptz not null default now(),
  status       text not null default 'active'
               check (status in ('active','completed','reassigned')),
  completed_on timestamptz,
  notes        text,
  updated_at   timestamptz not null default now()
);

create index if not exists contact_follow_ups_contact_idx
  on public.contact_follow_ups(contact_id);
create index if not exists contact_follow_ups_assignee_idx
  on public.contact_follow_ups(assigned_to);

alter table public.contact_follow_ups enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='contact_follow_ups' and policyname='contact_follow_ups_read') then
    create policy "contact_follow_ups_read" on public.contact_follow_ups
      for select using (
        is_core_admin() or assigned_to = auth.uid()
        or exists (select 1 from public.contacts c
          where c.id = contact_follow_ups.contact_id
            and (is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid()))
      );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='contact_follow_ups' and policyname='contact_follow_ups_insert') then
    create policy "contact_follow_ups_insert" on public.contact_follow_ups
      for insert with check (
        is_core_admin()
        or exists (select 1 from public.contacts c
          where c.id = contact_follow_ups.contact_id
            and (is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid()))
      );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='contact_follow_ups' and policyname='contact_follow_ups_update') then
    create policy "contact_follow_ups_update" on public.contact_follow_ups
      for update using (
        is_core_admin()
        or exists (select 1 from public.contacts c
          where c.id = contact_follow_ups.contact_id
            and (is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid()))
      );
  end if;
end $$;

-- ─── contact_audit_log ────────────────────────────────────────────────────────

create table if not exists public.contact_audit_log (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid references public.contacts(id) on delete set null,
  action         text not null,
  changed_by     uuid not null references public.profiles(id) on delete restrict,
  change_details jsonb not null default '{}'::jsonb,
  reason         text,
  created_at     timestamptz not null default now()
);

create index if not exists contact_audit_log_contact_idx
  on public.contact_audit_log(contact_id);

alter table public.contact_audit_log enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='contact_audit_log' and policyname='contact_audit_log_read') then
    create policy "contact_audit_log_read" on public.contact_audit_log
      for select using (is_core_admin());
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='contact_audit_log' and policyname='contact_audit_log_insert') then
    create policy "contact_audit_log_insert" on public.contact_audit_log
      for insert with check (changed_by = auth.uid());
  end if;
end $$;
