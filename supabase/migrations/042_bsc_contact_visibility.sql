-- 042_bsc_contact_visibility.sql
-- BSC members can see each other's outreach contacts, but contact_phone and
-- notes are masked.  BSC leaders and cell leaders retain full visibility.
--
-- Strategy:
--   1. Two helper functions to identify BSC leaders and BSC peers.
--   2. Extend contacts_read RLS to admit BSC access.
--   3. A security-invoker view (contacts_bsc_view) that returns NULL for
--      contact_phone/notes when the viewer is only a BSC peer, plus a
--      sensitive_hidden boolean so the frontend can distinguish "not recorded"
--      from "hidden by policy".
--   4. All writes still target the base table directly.

-- ─── 1. Helper: BSC leader for the logger ─────────────────────────────────────
-- True when auth.uid() is the leader of the BSC that p_logged_by belongs to.

create or replace function public.is_bsc_leader_for_logger(p_logged_by uuid)
returns boolean
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles logger
    join public.bscs b on b.id = logger.bsc_id
    where logger.id = p_logged_by
      and b.leader_id = auth.uid()
  );
$$;

-- ─── 2. Helper: BSC peer of the logger ────────────────────────────────────────
-- True when auth.uid() shares a non-null BSC with p_logged_by, is not the
-- same person, and is not the BSC leader (leader uses the function above).

create or replace function public.is_bsc_peer_of_logger(p_logged_by uuid)
returns boolean
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles viewer
    join public.profiles logger on logger.bsc_id = viewer.bsc_id
    where viewer.id    = auth.uid()
      and logger.id    = p_logged_by
      and viewer.bsc_id is not null
      and viewer.id   <> p_logged_by
      and not exists (
        select 1 from public.bscs b
        where b.id = viewer.bsc_id and b.leader_id = auth.uid()
      )
  );
$$;

-- ─── 3. Extend contacts_read to include BSC access ────────────────────────────

drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts
  for select using (
    public.is_core_admin()
    or public.is_cell_leader_of(cell_id)
    or logged_by = auth.uid()
    or public.is_bsc_leader_for_logger(logged_by)
    or public.is_bsc_peer_of_logger(logged_by)
  );

-- ─── 4. View: mask sensitive fields for BSC peers ─────────────────────────────
-- security_invoker = true → the view runs as the calling user, so the base
-- table's RLS still filters rows.  The CASE expressions then null out
-- contact_phone and notes for rows where the viewer is only a BSC peer.

drop view if exists public.contacts_bsc_view;
create view public.contacts_bsc_view
with (security_invoker = true)
as
select
  c.id,
  c.cell_id,
  c.person_id,
  c.contact_name,
  c.email,
  c.phone_hidden,
  c.tag,
  c.follow_up_status,
  c.follow_up_assignee,
  c.date_contacted,
  c.is_member,
  c.member_id,
  c.logged_by,
  c.archived,
  c.created_at,
  c.updated_at,
  -- Sensitive fields: returned only when the viewer has full access.
  case
    when c.logged_by = auth.uid()
      or public.is_core_admin()
      or public.is_cell_leader_of(c.cell_id)
      or public.is_bsc_leader_for_logger(c.logged_by)
    then c.contact_phone
    else null
  end as contact_phone,
  case
    when c.logged_by = auth.uid()
      or public.is_core_admin()
      or public.is_cell_leader_of(c.cell_id)
      or public.is_bsc_leader_for_logger(c.logged_by)
    then c.notes
    else null
  end as notes,
  -- Frontend flag: true → fields are masked by policy, not merely empty.
  not (
    c.logged_by = auth.uid()
    or public.is_core_admin()
    or public.is_cell_leader_of(c.cell_id)
    or public.is_bsc_leader_for_logger(c.logged_by)
  ) as sensitive_hidden
from public.contacts c;

grant select on public.contacts_bsc_view to authenticated;
