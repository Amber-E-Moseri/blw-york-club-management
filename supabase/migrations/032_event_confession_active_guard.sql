-- 032_event_confession_active_guard.sql
--
-- F-3 fix: two own-data policies in migration 017 used bare auth.uid() = user_id
-- without calling is_active_member().  Pending and rejected accounts could
-- INSERT, UPDATE, and DELETE their own RSVPs and confession declarations.
--
-- Migration 022's dynamic rewriter only targets auth.role() = 'authenticated';
-- own-data (auth.uid() = user_id) patterns were not patched.
--
-- These are not privilege-escalation issues, but they are inconsistent with the
-- branch's stated invariant that all write access requires an active account.
-- READ access is preserved unchanged for now (pending accounts need to read
-- events to reach the approval screen).

-- event_rsvps: own writes require active status; reads preserved
drop policy if exists event_rsvps_own on public.event_rsvps;

create policy event_rsvps_read_own on public.event_rsvps
  for select
  using (auth.uid() = user_id);

create policy event_rsvps_write_own on public.event_rsvps
  for insert
  with check (auth.uid() = user_id and public.is_active_member());

create policy event_rsvps_update_own on public.event_rsvps
  for update
  using (auth.uid() = user_id and public.is_active_member())
  with check (auth.uid() = user_id and public.is_active_member());

create policy event_rsvps_delete_own on public.event_rsvps
  for delete
  using (auth.uid() = user_id and public.is_active_member());

-- confession_declarations: own writes require active status; reads preserved
drop policy if exists confession_declarations_own on public.confession_declarations;

create policy confession_declarations_read_own on public.confession_declarations
  for select
  using (auth.uid() = user_id);

create policy confession_declarations_write_own on public.confession_declarations
  for insert
  with check (auth.uid() = user_id and public.is_active_member());

create policy confession_declarations_update_own on public.confession_declarations
  for update
  using (auth.uid() = user_id and public.is_active_member())
  with check (auth.uid() = user_id and public.is_active_member());

create policy confession_declarations_delete_own on public.confession_declarations
  for delete
  using (auth.uid() = user_id and public.is_active_member());
