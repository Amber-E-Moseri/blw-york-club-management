-- 103_identity_link_queue_and_approval_gate.sql
--
-- Staff identity linking for pending accounts, and an approval gate. Forward-only. Migrations 000-102 are not modified.
-- No existing profile, person or link row is rewritten. This is the single authoritative migration 103.
--
-- Builds on 097 (_f2_staff_actor, _f2_valid_reason, identity_read_audit, get_person_identity), 099 (signup never links;
-- link_pending_profile_to_person is the only client link path) and 016 (approve_pending_member).
--
-- Contract enforced here:
--   * list_account_link_queue(p_reason): staff only (administrator or coordinator), requires a valid reason, and writes
--     an append-only identity_read_audit row (target_kind 'account_link', nil uuid target) on every call. It returns only
--     CONFIRMED, PENDING, UNLINKED profiles and the exact normalized-email person candidate's id and name. It returns no
--     email address and no other identity field. A profile with no matching person is still listed, with null candidate
--     fields, so staff can see it.
--   * approve_pending_member: any pending profile with person_id NULL is refused (42501) until it is linked. The profile
--     row is locked FOR UPDATE, so approval and linking serialise. Administrator and coordinator authorization is
--     unchanged. Every activation writes an append-only profile_approval_audit row (UPDATE, DELETE and TRUNCATE refused).
--     SECURITY DEFINER search_path is pinned to pg_catalog, public.
--   * link_pending_profile_to_person (099 checks kept): refuses an account with a pending email change
--     (auth.users.email_change, GoTrue's pending-new-address column). Locks the profile and person rows.
--   * identity_read_audit, profile_link_audit: TRUNCATE is refused by a statement-level guard, as for profile_approval_audit.
--
-- Not included: a unique index on profiles(person_id). It is not applied until the duplicate-data check in
-- docs/auth/email-otp-verification.md has been reviewed for the target database.

-- ─── 1. Audit target kind for account-link reads ──────────────────────────────────────────────────────────────────────
-- Widens the CHECK created unnamed in 097 (default name). The append-only trigger and no-client-access grants are untouched.

ALTER TABLE public.identity_read_audit
  DROP CONSTRAINT IF EXISTS identity_read_audit_target_kind_check;
ALTER TABLE public.identity_read_audit
  ADD CONSTRAINT identity_read_audit_target_kind_check
  CHECK (target_kind IN ('claim', 'person', 'account_link'));

-- ─── 2. Pending email change: GoTrue keeps the NEW address in auth.users.email_change until it is confirmed ───────────
-- (email_change is the column; "new_email" is a field of GoTrue's API JSON, not a database column.)

CREATE OR REPLACE FUNCTION public._auth_has_pending_email_change(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_user_id
       AND nullif(btrim(u.email_change), '') IS NOT NULL
  )
$$;

REVOKE ALL ON FUNCTION public._auth_has_pending_email_change(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 3. Approval audit (append-only, no client access, TRUNCATE refused) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profile_approval_audit (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id  uuid        NOT NULL,
  actor_id    uuid        NOT NULL,
  action      text        NOT NULL CHECK (action IN ('approve')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_approval_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_approval_audit FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS profile_approval_audit_append_only ON public.profile_approval_audit;
CREATE TRIGGER profile_approval_audit_append_only
  BEFORE UPDATE OR DELETE ON public.profile_approval_audit
  FOR EACH ROW EXECUTE FUNCTION public._f2_refuse_audit_mutation();

-- TRUNCATE bypasses row-level triggers, so it needs its own statement-level guard. It applies to every role, including
-- the table owner.
DROP TRIGGER IF EXISTS profile_approval_audit_no_truncate ON public.profile_approval_audit;
CREATE TRIGGER profile_approval_audit_no_truncate
  BEFORE TRUNCATE ON public.profile_approval_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public._f2_refuse_audit_mutation();

-- The same statement-level guard for the two existing audit tables, which had row triggers only (097, 099).
DROP TRIGGER IF EXISTS identity_read_audit_no_truncate ON public.identity_read_audit;
CREATE TRIGGER identity_read_audit_no_truncate
  BEFORE TRUNCATE ON public.identity_read_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public._f2_refuse_audit_mutation();

DROP TRIGGER IF EXISTS profile_link_audit_no_truncate ON public.profile_link_audit;
CREATE TRIGGER profile_link_audit_no_truncate
  BEFORE TRUNCATE ON public.profile_link_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public._f2_refuse_audit_mutation();

-- ─── 4. Approval gate: an account with no linked person cannot be approved (replaces 016 approve_pending_member) ─────────

CREATE OR REPLACE FUNCTION public.approve_pending_member(target_member_id uuid)
RETURNS TABLE (id uuid, email text, full_name text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_admin_or_coordinator() THEN
    RAISE EXCEPTION 'Not authorised to approve members.' USING ERRCODE = '42501';
  END IF;

  -- Lock the profile row. link_pending_profile_to_person locks the same row, so the gate below and the activation see
  -- one consistent state: an account cannot be approved in the gap before its link commits.
  SELECT * INTO v_profile
    FROM public.profiles p
   WHERE p.id = target_member_id
     FOR UPDATE;

  -- Unknown or non-pending account: no row, as in 016.
  IF NOT FOUND OR v_profile.status <> 'pending' THEN
    RETURN;
  END IF;

  IF v_profile.person_id IS NULL THEN
    RAISE EXCEPTION 'Link this account to its existing person before approving it.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH approved AS (
    UPDATE public.profiles p
       SET status = 'active',
           updated_at = now()
     WHERE p.id = target_member_id
       AND p.status = 'pending'
    RETURNING p.id, p.email, p.full_name, p.status
  ), audited AS (
    INSERT INTO public.profile_approval_audit (profile_id, actor_id, action)
    SELECT a.id, v_actor, 'approve' FROM approved a
    RETURNING profile_id
  )
  SELECT a.id, a.email, a.full_name, a.status
    FROM approved a
   WHERE a.id IN (SELECT profile_id FROM audited);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pending_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_pending_member(uuid) TO authenticated;

-- ─── 5. Link RPC: 099 checks kept, pending email change refused (same signature) ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.link_pending_profile_to_person(
  p_profile_id uuid,
  p_person_id  uuid,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor          uuid := public._f2_staff_actor();
  v_profile        public.profiles%ROWTYPE;
  v_person         public.people%ROWTYPE;
  v_auth_email     text;
  v_auth_confirmed boolean;
BEGIN
  PERFORM public._f2_valid_reason(p_reason);

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

  -- One account per person, whatever that account's status.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.person_id = p_person_id) THEN
    RAISE EXCEPTION 'That person already has an account.' USING ERRCODE = 'P0001';
  END IF;

  -- Verified ownership: the confirmed auth email must equal the person's email.
  SELECT u.email, (u.email_confirmed_at IS NOT NULL)
    INTO v_auth_email, v_auth_confirmed
    FROM auth.users u
   WHERE u.id = p_profile_id;

  IF NOT FOUND OR NOT coalesce(v_auth_confirmed, false) OR v_auth_email IS NULL
     OR public.normalize_identity_email(v_auth_email) IS DISTINCT FROM public.normalize_identity_email(v_person.email) THEN
    RAISE EXCEPTION 'The account email is not a confirmed match for this person.' USING ERRCODE = '42501';
  END IF;

  IF public._auth_has_pending_email_change(p_profile_id) THEN
    RAISE EXCEPTION 'This account has a pending email change. Resolve it before linking.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles p
     SET person_id = p_person_id,
         updated_at = now()
   WHERE p.id = p_profile_id;

  INSERT INTO public.profile_link_audit (profile_id, person_id, actor_id, action, reason)
  VALUES (p_profile_id, p_person_id, v_actor, 'attach', btrim(p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.link_pending_profile_to_person(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_pending_profile_to_person(uuid, uuid, text) TO authenticated;

-- ─── 6. The single staff queue: confirmed, pending, unlinked profiles with their exact-match candidate ──────────────────

CREATE OR REPLACE FUNCTION public.list_account_link_queue(p_reason text)
RETURNS TABLE (
  profile_id    uuid,
  display_name  text,
  created_at    timestamptz,
  person_id     uuid,
  person_name   text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public._f2_staff_actor();
BEGIN
  PERFORM public._f2_valid_reason(p_reason);

  INSERT INTO public.identity_read_audit (actor_id, target_kind, target_id, reason)
  VALUES (v_actor, 'account_link', '00000000-0000-0000-0000-000000000000'::uuid, btrim(p_reason));

  RETURN QUERY
    SELECT pr.id,
           pr.full_name::text,
           au.created_at,
           m.id,
           m.full_name::text
      FROM public.profiles pr
      JOIN auth.users au ON au.id = pr.id
      LEFT JOIN LATERAL (
        SELECT pe.id, pe.full_name
          FROM public.people pe
         WHERE public.normalize_identity_email(pe.email) = public.normalize_identity_email(au.email)
         ORDER BY pe.id
         LIMIT 1
      ) m ON true
     WHERE pr.status = 'pending'
       AND pr.person_id IS NULL
       AND au.email_confirmed_at IS NOT NULL
     ORDER BY au.created_at, pr.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_account_link_queue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_account_link_queue(text) TO authenticated;
