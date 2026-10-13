-- 091_contacts_active_member_logging.sql
--
-- Forward-only. PROPOSED, NOT APPLIED: diff review and approval first.
--
-- Approved rule: active ordinary members can log outreach contacts.
--
-- 016 allowed a contact INSERT only to admins, coordinators and the leader of the contact's cell. This keeps those
-- branches exactly as they were and adds one branch for an active ordinary member:
--   * the active-member gate (is_active_member) excludes pending, inactive and rejected accounts;
--   * logged_by must be the caller, so a member cannot record a contact as another logger;
--   * the contact's cell must be the caller's own cell or no cell (unassigned), so a member cannot attribute a contact
--     to a cell they do not belong to.
--
-- Read access is unchanged: contacts_read (005) already lets a logger read their own contacts (logged_by = auth.uid())
-- and nothing else for ordinary members. No UPDATE or DELETE policy is added.
--
-- Dependencies: 005 (contacts table, contacts_read), 016 (contacts_insert_scoped, replaced here), 022 (is_active_member).

drop policy if exists contacts_insert_scoped on public.contacts;

create policy contacts_insert_scoped on public.contacts
  for insert
  with check (
    public.is_admin_or_coordinator()
    or public.is_cell_leader_of(cell_id)
    or (
      public.is_active_member()
      and logged_by = auth.uid()
      and (
        cell_id is null
        or cell_id is not distinct from (
          select p.cell_id from public.profiles p where p.id = auth.uid()
        )
      )
    )
  );
