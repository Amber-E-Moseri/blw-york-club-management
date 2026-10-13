-- 071_messaging_leadership_and_policy_correction.sql
--
-- Owner workstream: Targeted messages / announcements (forward-only correction)
-- Dependencies:    054 (is_cell_leader_of: leadership is cells.leader_id, not a role label),
--                  059 (audience_specs), 063 (affirmation RLS), 064 (announcements_manage),
--                  068 (audience scope), 069 (targeted messages), 070 (leader spec insert)
--
-- Problems corrected (found by parity review of integ/blwyork-unified-candidate against feat/blwyork-messaging 8fe40b3):
--   1. assert_can_send_message() (069) authorized leaders by profiles.role = 'cell_leader' and profiles.cell_id.
--      Migration 054 says leadership is cells.leader_id = auth.uid(). A role label grants nothing, and cell membership
--      grants nothing. This function now uses is_cell_leader_of() for every named cell, and admin/coordinator
--      through is_admin_or_coordinator().
--   2. communication_messages.sender_role (069) rejected the 'member' label, which a real leader may hold.
--   3. announcements_manage (064/068) required the role label and let a leader manage any announcement that targeted
--      their cell, including other people's. A leader now writes and manages only announcements they authored, only
--      for a cells-mode spec naming one cell they currently lead. A null spec is never allowed for a leader.
--
-- Revocation: every check is evaluated live against cells.leader_id and is_active_member(), so a former leader loses
-- access as soon as cells.leader_id changes. Nothing is cached.
--
-- Forward-only: function and policy replacements plus one constraint change. No table is dropped and no earlier
-- migration is edited.

-- ── 1. Leader authorization for internal messages (replaces 069's version) ───

create or replace function public.assert_can_send_message(
  p_mode        text,
  p_cell_ids    uuid[],
  p_group_ids   uuid[],
  p_profile_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Active account only (pending, rejected and inactive accounts fail is_active_member()).
  if not public.is_active_member() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  if p_mode not in ('all','cells','saved_groups','explicit') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;

  if public.is_admin_or_coordinator() then
    null; -- any audience
  else
    -- A leader may address only cells they lead (cells.leader_id = auth.uid()), in cells mode.
    -- Membership (profiles.cell_id) and the cell_leader role label grant nothing.
    if p_mode <> 'cells' or coalesce(cardinality(p_cell_ids), 0) = 0 then
      raise exception 'not_authorised' using errcode = '42501';
    end if;
    if exists (select 1 from unnest(p_cell_ids) as c(id) where not public.is_cell_leader_of(c.id)) then
      raise exception 'outside_cell' using errcode = '42501';
    end if;
  end if;

  -- Every named target must exist. An unknown id is an error, not a silent drop.
  if p_mode = 'cells' and exists (
    select 1 from unnest(p_cell_ids) as c(id)
    where not exists (select 1 from public.cells where cells.id = c.id)
  ) then
    raise exception 'unknown_cell' using errcode = '22023';
  end if;
  if p_mode = 'saved_groups' and exists (
    select 1 from unnest(p_group_ids) as g(id)
    where not exists (select 1 from public.saved_groups sg where sg.id = g.id and sg.is_active)
  ) then
    raise exception 'unknown_group' using errcode = '22023';
  end if;
  if p_mode = 'explicit' and exists (
    select 1 from unnest(p_profile_ids) as p(id)
    where not exists (select 1 from public.profiles where profiles.id = p.id)
  ) then
    raise exception 'unknown_recipient' using errcode = '22023';
  end if;
end;
$$;

-- ── 2. Allow the 'member' label on the sender record ──────────────────────────

alter table public.communication_messages
  drop constraint if exists communication_messages_sender_role_check;
alter table public.communication_messages
  add constraint communication_messages_sender_role_check
  check (sender_role in ('admin','coordinator','cell_leader','member'));

-- ── 3. Cell-leader announcements: assignment decides; authors only; never a broadcast ──

drop policy if exists announcements_manage on public.announcements;
create policy announcements_manage on public.announcements
  for all
  to authenticated
  using (
    public.is_admin_or_coordinator()
    or (
      public.is_active_member()
      and author_id = auth.uid()
      and audience_spec_id is not null
      and exists (
        select 1 from public.audience_specs s
        where s.id = announcements.audience_spec_id
          and s.mode = 'cells'
          and array_length(s.cell_ids, 1) = 1
          and public.is_cell_leader_of(s.cell_ids[1])
      )
    )
  )
  with check (
    public.is_admin_or_coordinator()
    or (
      public.is_active_member()
      and author_id = auth.uid()
      and audience_spec_id is not null
      and exists (
        select 1 from public.audience_specs s
        where s.id = audience_spec_id
          and s.mode = 'cells'
          and array_length(s.cell_ids, 1) = 1
          and public.is_cell_leader_of(s.cell_ids[1])
      )
    )
  );
