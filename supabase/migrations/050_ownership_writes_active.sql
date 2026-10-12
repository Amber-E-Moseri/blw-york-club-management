-- 050_ownership_writes_active.sql
--
-- Owner-scoped writes require an active account. Before this migration, an owner-only write policy checked
-- auth.uid() alone, so a pending or rejected account could create or change testimonies, comments, reactions,
-- weekly messages, email and push preferences, and drive links it owns. Pending and rejected accounts keep onboarding
-- capabilities only (decision 2).
--
-- Changes: the owner write policies below are recreated with is_active_member(). Staff branches (core admin, coordinator
-- and admin, through is_admin_or_coordinator / is_core_admin) are unchanged; both already require an active account.
-- Owner SELECT policies are unchanged. push_subscriptions_delete_own is kept as-is, so a user can always remove a
-- device subscription.
-- Forward-only: drop and recreate policies. No table, column, function or grant change.

-- testimonies
drop policy if exists testimonies_insert on public.testimonies;
create policy testimonies_insert on public.testimonies
  for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_member());

drop policy if exists testimonies_update on public.testimonies;
create policy testimonies_update on public.testimonies
  for update to authenticated
  using (author_id = auth.uid() and public.is_active_member())
  with check (author_id = auth.uid() and public.is_active_member());

drop policy if exists testimonies_delete on public.testimonies;
create policy testimonies_delete on public.testimonies
  for delete to authenticated
  using (author_id = auth.uid() and public.is_active_member());

-- testimony_comments
drop policy if exists comments_insert on public.testimony_comments;
create policy comments_insert on public.testimony_comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_member());

drop policy if exists comments_delete on public.testimony_comments;
create policy comments_delete on public.testimony_comments
  for delete to authenticated
  using (author_id = auth.uid() and public.is_active_member());

-- testimony_reactions
drop policy if exists reactions_insert on public.testimony_reactions;
create policy reactions_insert on public.testimony_reactions
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_member());

drop policy if exists reactions_delete on public.testimony_reactions;
create policy reactions_delete on public.testimony_reactions
  for delete to authenticated
  using (user_id = auth.uid() and public.is_active_member());

-- weekly_messages
drop policy if exists weekly_messages_insert on public.weekly_messages;
create policy weekly_messages_insert on public.weekly_messages
  for insert to authenticated
  with check (
    auth.uid() = created_by
    and public.is_active_member()
    and ((scope)::text = 'personal' or public.is_admin_or_coordinator())
  );

drop policy if exists weekly_messages_update on public.weekly_messages;
create policy weekly_messages_update on public.weekly_messages
  for update to authenticated
  using ((auth.uid() = created_by and public.is_active_member()) or public.is_admin_or_coordinator())
  with check ((auth.uid() = created_by and public.is_active_member()) or public.is_admin_or_coordinator());

drop policy if exists weekly_messages_delete on public.weekly_messages;
create policy weekly_messages_delete on public.weekly_messages
  for delete to authenticated
  using ((auth.uid() = created_by and public.is_active_member()) or public.is_admin_or_coordinator());

-- email_preferences
drop policy if exists email_preferences_insert_own on public.email_preferences;
create policy email_preferences_insert_own on public.email_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_member());

drop policy if exists email_preferences_update_own on public.email_preferences;
create policy email_preferences_update_own on public.email_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_member())
  with check (user_id = auth.uid() and public.is_active_member());

-- push_subscriptions (delete stays as-is)
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_member());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_member())
  with check (user_id = auth.uid() and public.is_active_member());

-- drive_link_metadata (owner or core admin; both branches require an active account)
drop policy if exists drive_links_manage on public.drive_link_metadata;
create policy drive_links_manage on public.drive_link_metadata
  for all to authenticated
  using ((owner_id = auth.uid() and public.is_active_member()) or public.is_core_admin())
  with check ((owner_id = auth.uid() and public.is_active_member()) or public.is_core_admin());
