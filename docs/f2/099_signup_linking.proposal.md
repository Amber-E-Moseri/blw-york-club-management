# 099 signup linking (N1): PROPOSAL, not applied

This is a proposal document. It is not a migration and must not be run. It becomes `supabase/migrations/099_signup_linking.sql` only after explicit approval (see `099_signup_linking_design.md`, section 6). The SQL below is the reviewed draft, rehearsed on a disposable clone only.

```sql
-- PROPOSAL ONLY. NOT A MIGRATION. NOT APPLIED ANYWHERE. Lives outside supabase/migrations so no tool applies it.
--
-- Subject: N1. An unverified signup must not claim an existing person through email matching.
-- Requires explicit approval before it is moved to migrations/099_signup_linking.sql. Approval is needed because it
-- changes signup and approval semantics. See docs/f2/099_signup_linking_design.md for the plan, the GoTrue facts that
-- are not verified here, and the historical audit.
--
-- Invariants this proposal establishes:
--   I1  Signup (auth.users INSERT, whether or not the email is confirmed) never links a profile to an existing person.
--   I2  A profile is linked to an existing person only after the account's email is VERIFIED and a staff member APPROVES
--       that exact link. Approval is audited.
--   I3  An email that no person holds, once verified, creates a new person for that account (the registration path).
--   I4  A pending or unlinked account reads no person row.
--
-- Prerequisite: the auth.users table must carry email_confirmed_at, as GoTrue provides it. The disposable-clone rehearsal
-- (run on cert_f2, rolled back) added that column inside its transaction. The rehearsal is not part of this file.
-- Rehearsal result: T1 unverified signup not linked, T2 verified match requests a link without linking,
-- T3 verified new email creates and links a person, T4 unauthenticated decision refused (42501).
-- NOT YET TESTED: an approve or reject decision by a real coordinator, and GoTrue's own trigger wiring.

-- 1. Staging state on the profile. A link that is waiting for staff.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'none'
  CHECK (link_status IN ('none', 'link_requested'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS link_requested_person_id uuid REFERENCES public.people (id) ON DELETE SET NULL;

-- 2. Audit of every link decision. Append-only.
CREATE TABLE IF NOT EXISTS public.profile_link_audit (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id   uuid NOT NULL,
  person_id    uuid,
  action       text NOT NULL CHECK (action IN ('created_person', 'link_requested', 'approved', 'rejected')),
  actor_id     uuid,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_link_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_link_audit FROM PUBLIC, anon, authenticated, service_role;

-- 3. Signup: create the profile only. It never reads or writes people. Runs for every signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1));
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status, student_number, avatar_url, joined_at, person_id)
  VALUES (new.id, new.email, v_name, 'member', 'pending',
          new.raw_user_meta_data ->> 'student_number', new.raw_user_meta_data ->> 'avatar_url', new.created_at, NULL)
  ON CONFLICT (id) DO UPDATE SET email = excluded.email;

  -- An account created already confirmed (mailer autoconfirm) is verified at once.
  IF new.email_confirmed_at IS NOT NULL THEN
    PERFORM public._link_verified_account(new.id, new.email);
  END IF;
  RETURN new;
END;
$$;

-- 4. Verification: the account's email is proven once GoTrue sets email_confirmed_at.
CREATE OR REPLACE FUNCTION public._on_email_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF new.email_confirmed_at IS NOT NULL AND old.email_confirmed_at IS NULL THEN
    PERFORM public._link_verified_account(new.id, new.email);
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS auth_user_email_verified ON auth.users;
CREATE TRIGGER auth_user_email_verified
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._on_email_verified();

-- 5. Linking after verification. A matching person is NEVER linked here: the link is requested and waits for staff.
CREATE OR REPLACE FUNCTION public._link_verified_account(p_profile_id uuid, p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_norm    text := public.normalize_identity_email(p_email);
  v_person  uuid;
  v_name    text;
BEGIN
  SELECT p.id INTO v_person FROM public.people p
   WHERE public.normalize_identity_email(p.email) = v_norm
   ORDER BY p.created_at LIMIT 1;

  IF v_person IS NULL THEN
    -- I3: no person holds this verified email, so the account gets a new one.
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = p_profile_id;
    INSERT INTO public.people (full_name, email) VALUES (v_name, p_email) RETURNING id INTO v_person;
    UPDATE public.profiles SET person_id = v_person WHERE id = p_profile_id;
    INSERT INTO public.profile_link_audit (profile_id, person_id, action) VALUES (p_profile_id, v_person, 'created_person');
  ELSE
    -- I2: a person already holds the verified email. Request the link. Staff decide.
    UPDATE public.profiles SET link_status = 'link_requested', link_requested_person_id = v_person WHERE id = p_profile_id;
    INSERT INTO public.profile_link_audit (profile_id, person_id, action) VALUES (p_profile_id, v_person, 'link_requested');
  END IF;
END;
$$;

-- 6. Staff decision on a requested link. Admin or coordinator, active, reason required, one decision per request.
CREATE OR REPLACE FUNCTION public.decide_profile_link(p_profile_id uuid, p_decision text, p_reason text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_person uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_coordinator() THEN
    RAISE EXCEPTION 'You are not authorised to decide identity links.' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Give a reason (3 to 500 characters).' USING ERRCODE = '22023';
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Choose approve or reject.' USING ERRCODE = '22023';
  END IF;

  SELECT pr.link_requested_person_id INTO v_person FROM public.profiles pr
   WHERE pr.id = p_profile_id AND pr.link_status = 'link_requested' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No link is waiting for this account.' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision = 'approve' THEN
    UPDATE public.profiles SET person_id = v_person, link_status = 'none', link_requested_person_id = NULL WHERE id = p_profile_id;
    INSERT INTO public.profile_link_audit (profile_id, person_id, action, actor_id, reason) VALUES (p_profile_id, v_person, 'approved', v_actor, btrim(p_reason));
  ELSE
    UPDATE public.profiles SET link_status = 'none', link_requested_person_id = NULL WHERE id = p_profile_id;
    INSERT INTO public.profile_link_audit (profile_id, person_id, action, actor_id, reason) VALUES (p_profile_id, v_person, 'rejected', v_actor, btrim(p_reason));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_profile_link(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_profile_link(uuid, text, text) TO authenticated;

-- 7. Pending and unlinked accounts read no person row (I4). An active account keeps its own linked row.
CREATE OR REPLACE FUNCTION public.is_callers_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT exists (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.person_id = p_person_id AND p.status = 'active'
  );
$$;
```
