-- 024_api_privileges_and_defaults.sql
--
-- The canonical table-privilege matrix for the Supabase API roles, and safe defaults for FUTURE objects.
-- It supersedes the additive grants of 020: it first removes everything, then grants the exact matrix, so the
-- result is the same on a fresh database and on one that inherited broad legacy privileges.
--
-- Principles
--   * Row Level Security remains the authorization boundary. GRANT only decides whether a role may attempt an
--     operation; each privilege below exists because an RLS policy on that table can allow it.
--   * anon        : no access to any table or sequence. The client reads no table before sign-in.
--   * authenticated: exactly the operations that the table's final policies can allow. Never the table-wipe
--                    privilege (it bypasses RLS), REFERENCES, TRIGGER or MAINTAIN.
--   * service_role : SELECT/INSERT/UPDATE/DELETE on the tables the backend uses (it bypasses RLS). None of
--                    the table-wipe, REFERENCES, TRIGGER or MAINTAIN privileges. No access to
--                    admin_bootstrap_audit (owner-only).
--   * Sequences    : none exist in this schema. anon and authenticated hold no sequence privileges.
--
-- Future objects
--   Tables, sequences and functions created by the migration owner (postgres) in schema public no longer receive
--   automatic grants for the API roles; every new table must GRANT what its policies need, in the same migration.
--   Limits that cannot be changed from a migration, enforced by the release certification instead:
--     * the migration role may not alter the default privileges of Supabase-managed roles (supabase_admin);
--     * a new function still starts with PostgreSQL's built-in PUBLIC EXECUTE, so every migration that adds a
--       function must revoke it (see 023); the certification fails on any function that is not on the allow-list.

-- 1. Remove all existing privileges.
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

-- 2. authenticated: the exact matrix implied by the final RLS policies.
grant select, insert, update, delete on table
  public.admin_role_assignments, public.admin_role_permissions, public.admin_roles,
  public.announcements, public.attendance_imports, public.attendance_member_matches,
  public.books_of_month, public.cells, public.confession_declarations, public.confessions,
  public.contacts, public.devotional_daily_pages, public.devotional_views, public.drive_link_metadata,
  public.email_log, public.event_rsvps, public.events,
  public.foundation_school_classes, public.foundation_school_enrollments, public.foundation_school_progress,
  public.habit_entries, public.habit_templates, public.meetings, public.monthly_devotionals,
  public.people, public.prayer_requests, public.profiles, public.push_subscriptions,
  public.status_settings, public.tags_settings, public.testimonies, public.user_profiles,
  public.weekly_messages, public.zoom_settings
to authenticated;

grant select, insert on table
  public.contact_audit_log, public.email_notification_log, public.membership_transitions
to authenticated;

grant select, insert, update on table
  public.contact_follow_ups, public.email_preferences, public.memberships
to authenticated;

grant select, insert, delete on table
  public.contact_tags, public.testimony_comments, public.testimony_reactions
to authenticated;

grant select on table public.push_notification_log, public.zoom_attendance to authenticated;
grant select on table public.member_directory to authenticated;

-- No authenticated access (no policy can allow anything): meeting_attendances, scheduled_emails,
-- admin_bootstrap_audit.

-- 3. service_role: backend access to every application table except the owner-only bootstrap audit.
grant select, insert, update, delete on all tables in schema public to service_role;
revoke all on table public.admin_bootstrap_audit from service_role;
revoke insert, update, delete on table public.member_directory from service_role;

-- 4. Defaults for objects created by the migration owner in schema public.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;

-- Supabase-managed role: not alterable from a migration. Try; if denied, the certification enforces the invariant.
do $$
begin
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated, service_role;
  alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, service_role;
  alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated, service_role;
exception when insufficient_privilege then
  raise notice 'supabase_admin default privileges are managed by Supabase and cannot be changed here; enforced by the release certification.';
end $$;
