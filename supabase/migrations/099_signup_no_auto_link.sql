-- 099_signup_no_auto_link.sql
--
-- N1 remediation (docs/f2/099_signup_linking_design.md, approved for implementation). Forward-only. Migrations 000-098 are
-- not modified. No existing profile or person row is rewritten.
--
-- Defect (N1). handle_new_user (019) linked every new auth account to an existing public.people row with the same
-- normalized email, with no verification check. The linked profile was pending, which hid that person from ordinary
-- members (N1d) and let the impostor read the person's name before any approval (N1e, N1f).
--
-- Contract enforced here:
--   * A signup never links to an existing person. Matching email is not a link.
--   * A signup with an email that matches an existing person creates no person row (the normalized email is unique)
--     and succeeds with an UNLINKED pending profile. The existing person stays visible to the directory.
--   * A signup with an email that matches no person creates a person, as before (registration path unchanged).
--   * A link to an existing person happens only through link_pending_profile_to_person: a staff action that needs a
--     reason, writes an append-only audit row, and requires the account's auth email to be CONFIRMED (email_confirmed_at)
--     and equal to the person's email. Confirmation is read from auth.users, so this does not depend on the local or
--     production value of enable_confirmations. Provider-verified OAuth accounts carry email_confirmed_at too.
--   * An unlinked or pending account reads no person row. An account reads its own person only while ACTIVE.
--   * A rejected account keeps no read of anything it is not linked to (rejection changes status only; see 016).
--   * Existing links made before 099 are kept. A read-only query lists them for staff review
--     (supabase/verification/n1_historical_link_audit.sql). Nothing unlinks them here.
--
-- Open decisions carried from the design, not decided here: retention of any future link queue (none is created by this
-- migration; staff discover candidates through the audit query and the RPC). A new email still creates a person row at
-- signup, so an unverified signup can reserve an email that no person yet holds (see the report).

-- ─── 1. Signup: never link to an existing person (replaces 019) ───────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  profile_name text := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1));
  v_person_id  uuid;
  v_email_held boolean;
begin
  -- Email match is only a fact about the directory. It is never a link (N1).
  select exists (
    select 1 from public.people p
    where public.normalize_identity_email(p.email) = public.normalize_identity_email(new.email)
  ) into v_email_held;

  if not v_email_held then
    begin
      insert into public.people (full_name, email)
      values (profile_name, new.email)
      returning id into v_person_id;
    exception when unique_violation then
      -- A concurrent signup or person insert took the email between the check and the insert. Stay unlinked.
      v_person_id := null;
    end;
  end if;

  insert into public.profiles (
    id, email, full_name, role, status, student_number, avatar_url, joined_at, person_id
  )
  values (
    new.id,
    new.email,
    profile_name,
    'member',
    'pending',
    new.raw_user_meta_data->>'student_number',
    new.raw_user_meta_data->>'avatar_url',
    new.created_at,
    v_person_id
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name),
    student_number = coalesce(excluded.student_number, profiles.student_number),
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
    person_id = coalesce(profiles.person_id, excluded.person_id),
    updated_at = now();

  return new;
end;
$$;

-- ─── 2. Read rule: only an ACTIVE account reads its own linked person (tightens 095 section 2) ────────────────────────

create or replace function public.is_callers_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.person_id = p_person_id
      and p.status = 'active'
  )
$function$;

revoke all on function public.is_callers_person(uuid) from public, anon;
grant execute on function public.is_callers_person(uuid) to authenticated;

-- ─── 3. Audit of every link made through the RPC (append-only, no client access) ─────────────────────────────────────

create table if not exists public.profile_link_audit (
  id          bigint      generated always as identity primary key,
  profile_id  uuid        not null,
  person_id   uuid        not null,
  actor_id    uuid        not null,
  action      text        not null check (action in ('attach')),
  reason      text        not null,
  created_at  timestamptz not null default now()
);

alter table public.profile_link_audit enable row level security;
revoke all on table public.profile_link_audit from public, anon, authenticated, service_role;

drop trigger if exists profile_link_audit_append_only on public.profile_link_audit;
create trigger profile_link_audit_append_only
  before update or delete on public.profile_link_audit
  for each row execute function public._f2_refuse_audit_mutation();

-- ─── 4. The only client path that links a pending account to an existing person ─────────────────────────────────────

create or replace function public.link_pending_profile_to_person(
  p_profile_id uuid,
  p_person_id  uuid,
  p_reason     text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor          uuid := public._f2_staff_actor();
  v_profile        public.profiles%ROWTYPE;
  v_person         public.people%ROWTYPE;
  v_verified_email text;
begin
  perform public._f2_valid_reason(p_reason);

  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_profile.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending account can be linked.' USING ERRCODE = '42501';
  END IF;
  IF v_profile.person_id IS NOT NULL THEN
    RAISE EXCEPTION 'This account is already linked to a person.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_person FROM public.people p WHERE p.id = p_person_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Person not found.' USING ERRCODE = 'P0002';
  END IF;

  -- One account per person. A person already linked to any account is refused, whatever that account's status.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.person_id = p_person_id) THEN
    RAISE EXCEPTION 'That person already has an account.' USING ERRCODE = 'P0001';
  END IF;

  -- Verified ownership: the account's auth email is confirmed AND it is the person's email. Nothing else links.
  SELECT u.email INTO v_verified_email
    FROM auth.users u
   WHERE u.id = p_profile_id AND u.email_confirmed_at IS NOT NULL;
  IF v_verified_email IS NULL
     OR public.normalize_identity_email(v_verified_email) IS DISTINCT FROM public.normalize_identity_email(v_person.email) THEN
    RAISE EXCEPTION 'The account email is not a confirmed match for this person.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles p
     SET person_id = p_person_id,
         updated_at = now()
   WHERE p.id = p_profile_id;

  INSERT INTO public.profile_link_audit (profile_id, person_id, actor_id, action, reason)
  VALUES (p_profile_id, p_person_id, v_actor, 'attach', btrim(p_reason));
END;
$$;

revoke all on function public.link_pending_profile_to_person(uuid, uuid, text) from public, anon;
grant execute on function public.link_pending_profile_to_person(uuid, uuid, text) to authenticated;
