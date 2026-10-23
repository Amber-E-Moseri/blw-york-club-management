-- 043_announcements_author_scoped_manage.sql
--
-- Cell leaders may edit and delete only the announcements they wrote. Admins and coordinators may still
-- manage any announcement. Posting is unchanged: admins, coordinators and active cell leaders may insert.
--
-- Migration 031 gave cell leaders one FOR ALL policy, so an update or delete by a cell leader was checked
-- against the role alone. This migration replaces it with one policy per command. UPDATE and DELETE check
-- the author; INSERT keeps the original rule. The UPDATE check also stops a cell leader from handing one of
-- their own posts to someone else. The read policy (announcements_read) and table grants (024) are unchanged.

drop policy if exists announcements_manage on public.announcements;
drop policy if exists announcements_insert on public.announcements;
drop policy if exists announcements_update on public.announcements;
drop policy if exists announcements_delete on public.announcements;

-- INSERT also requires author_id = auth.uid(). The author is never taken from the client as a claim of identity:
-- a post is attributed to the caller or it is refused.
create policy announcements_insert on public.announcements
  for insert
  with check (
    author_id = auth.uid()
    and (
      public.is_admin_or_coordinator()
      or exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'cell_leader'
          and status = 'active'
      )
    )
  );

create policy announcements_update on public.announcements
  for update
  using (
    public.is_admin_or_coordinator()
    or (
      author_id = auth.uid()
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'cell_leader'
          and status = 'active'
      )
    )
  )
  with check (
    public.is_admin_or_coordinator()
    or (
      author_id = auth.uid()
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'cell_leader'
          and status = 'active'
      )
    )
  );

create policy announcements_delete on public.announcements
  for delete
  using (
    public.is_admin_or_coordinator()
    or (
      author_id = auth.uid()
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'cell_leader'
          and status = 'active'
      )
    )
  );
