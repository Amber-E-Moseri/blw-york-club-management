-- 020_explicit_api_grants.sql
--
-- Purpose
--   Current Supabase Postgres images no longer auto-grant SELECT/INSERT/UPDATE/DELETE
--   on new public tables to the API roles. A database built only from migrations
--   000-019 therefore rejects every API call with "permission denied for table".
--   This migration states the table-level privileges explicitly so a fresh database
--   is usable through PostgREST without manual setup.
--
-- Authorization model (unchanged)
--   Row Level Security remains the authorization boundary. Every public table has RLS
--   enabled; this migration neither alters nor weakens any policy. A GRANT only lets a
--   role attempt an operation; RLS still decides which rows it may touch.
--
-- Least privilege
--   authenticated : only the operations that the table's existing RLS policies can
--                   ever allow (an ungranted operation would be denied by RLS anyway).
--   service_role  : SELECT/INSERT/UPDATE/DELETE on all current public tables. It already
--                   bypasses RLS; Edge Functions rely on it.
--   anon          : nothing. The client reads no table before sign-in, and sign-in/
--                   sign-up go through Auth, not these tables.
--   Intentionally NOT granted: the table-wipe, REFERENCES, TRIGGER and MAINTAIN privileges, ownership,
--   BYPASSRLS, sequence access (the schema has no sequences), or any new function
--   EXECUTE (helpers keep the default PUBLIC execute; RPCs are granted in 016/018).
--
-- Future tables
--   No ALTER DEFAULT PRIVILEGES is added on purpose. Migrations run as `postgres`, which
--   owns every object, so such defaults WOULD take effect, but they would silently expose
--   every future table to the API. Instead, each migration that creates a public table
--   must GRANT what its RLS policies need, in the same migration.
--
-- Safety
--   Additive and idempotent: GRANT never revokes, and re-granting an existing privilege
--   is a no-op. No schema, data, policy or role changes.

grant usage on schema public to anon, authenticated, service_role;

-- authenticated: full DML (policies exist for SELECT, INSERT, UPDATE and DELETE)
grant select, insert, update, delete on table
  public.admin_role_assignments,
  public.admin_role_permissions,
  public.admin_roles,
  public.announcements,
  public.attendance_imports,
  public.attendance_member_matches,
  public.books_of_month,
  public.cells,
  public.confession_declarations,
  public.confessions,
  public.contacts,
  public.devotional_daily_pages,
  public.devotional_views,
  public.drive_link_metadata,
  public.email_log,
  public.email_preferences,
  public.event_rsvps,
  public.events,
  public.foundation_school_classes,
  public.foundation_school_enrollments,
  public.foundation_school_progress,
  public.habit_entries,
  public.habit_templates,
  public.meetings,
  public.monthly_devotionals,
  public.people,
  public.prayer_requests,
  public.profiles,
  public.push_subscriptions,
  public.status_settings,
  public.tags_settings,
  public.testimonies,
  public.user_profiles,
  public.weekly_messages,
  public.zoom_settings
to authenticated;

-- authenticated: append-only tables (read + insert)
grant select, insert on table
  public.contact_audit_log,
  public.email_notification_log,
  public.membership_transitions,
  public.push_notification_log
to authenticated;

-- authenticated: read, insert, update (no delete policy)
grant select, insert, update on table
  public.contact_follow_ups,
  public.memberships
to authenticated;

-- authenticated: read, insert, delete (no update policy)
grant select, insert, delete on table
  public.contact_tags,
  public.testimony_comments,
  public.testimony_reactions
to authenticated;

-- authenticated: read-only
grant select on table public.zoom_attendance to authenticated;

-- authenticated: no grant on public.meeting_attendances or public.scheduled_emails.
-- Neither table has an RLS policy, so they are server-side only (service_role).

-- service_role: server-side access for Edge Functions and admin tooling (bypasses RLS)
grant select, insert, update, delete on all tables in schema public to service_role;
