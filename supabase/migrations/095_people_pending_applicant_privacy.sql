-- 095_people_pending_applicant_privacy.sql
--
-- Forward-only. PROPOSED, NOT APPLIED: diff review and approval first. Migrations 000-094 are not modified.
--
-- Problem. public.people holds one identity row per human, with email and phone. The signup trigger (019,
-- handle_new_user) inserts a row for every new account, so every pending applicant has one. people_read (015) let
-- every signed-in account read every people row. A cell leader, an ordinary member or another applicant could
-- therefore read a pending applicant's email and phone through public.people, and find_person_by_email (037) would
-- confirm that the email exists.
--
-- Approved policy for pending applicants (this migration):
--   * Admins and coordinators read every people row (unchanged).
--   * A person reads their own people row, when it is linked to their profile (profiles.person_id = auth.uid()'s profile).
--   * A people row linked to a PENDING profile is readable by nobody else. Cell leaders, ordinary members and other
--     applicants see neither the email nor the phone.
--   * Every other people row is readable by an ACTIVE account, as before for active members. Inactive and rejected
--     accounts lose reads of other people's rows (a tightening: they are not app users, App.tsx routes them to the
--     pending screen). Their own row stays readable. Walk-ins and active members are unchanged, so outreach logging and
--     contact search keep working. The policy no longer tests auth.role(): it requires an active, approved identity.
--
-- Not changed here (see the report): the unique indexes people_email_normalized_unique and people_phone_unique remain
-- global. An insert with a pending applicant's email still fails with a unique violation, so a member can learn that the
-- email exists. Removing that signal needs a separate decision about the identity model.
--
-- Dependencies: 015 (people, people_read), 018 (normalised identity indexes), 019 (handle_new_user links profiles to
-- people), 022 (is_admin_or_coordinator, profiles policies), 037 (find_person_by_email, SECURITY INVOKER).

-- ─── 1. Helpers (SECURITY DEFINER: the policy check must not depend on the caller's own profile visibility) ─────────────

create or replace function public.person_has_pending_profile(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1 from public.profiles p
    where p.person_id = p_person_id
      and p.status = 'pending'
  )
$function$;

create or replace function public.is_callers_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.person_id = p_person_id
  )
$function$;

revoke all on function public.person_has_pending_profile(uuid) from public, anon;
grant execute on function public.person_has_pending_profile(uuid) to authenticated;
revoke all on function public.is_callers_person(uuid) from public, anon;
grant execute on function public.is_callers_person(uuid) to authenticated;

-- ─── 2. Read rule for people ─────────────────────────────────────────────────────────────────────────────────────────

drop policy if exists "people_read" on public.people;
create policy "people_read" on public.people
  for select
  using (
    public.is_admin_or_coordinator()
    or public.is_callers_person(id)
    or (public.is_active_member() and not public.person_has_pending_profile(id))
  );

-- Insert, update and delete policies (015, 045, 018) are unchanged. The insert policy still lets any authenticated
-- account create a person (contact logging needs it), and its returned row is readable because it has no pending profile.
