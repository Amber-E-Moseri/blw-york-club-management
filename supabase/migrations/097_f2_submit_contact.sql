-- 097_f2_submit_contact.sql
--
-- F2 remediation, ADDITIVE. Introduces the database-controlled contact submission path, private identity claims,
-- audited staff identity access and identity-claim resolution. This migration revokes nothing. Direct writes to
-- people and contacts remain available until 098, which applies after the frontend has switched to these functions.
--
-- Design invariants (see the F2 design package):
--   * An existing person's email or phone is never overwritten, and identity is written only when no conflict was found.
--   * Every submission performs the same statements whatever the identity outcome, so the write set does not depend
--     on whether an identity matched. Each submission creates one contact, one subject person and one claim.
--   * No identity-uniqueness error reaches a client. Global unique indexes stay unchanged and are a backstop only.
--   * Idempotency uses the existing contacts_logged_by_idempotency_key_unique index. Distinct keys are independent logs.
--   * Lock order is fixed: idempotency, then normalized email, then normalized phone.
--   * Internal helpers have no EXECUTE for PUBLIC, anon or authenticated. Client-callable functions use fixed search_path.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Private identity claims and audit tables. No client grants. Rows are reachable only through the functions below.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.identity_claims (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            uuid        NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  subject_person_id     uuid        REFERENCES public.people (id) ON DELETE SET NULL,
  status                text        NOT NULL
                          CHECK (status IN ('unique', 'open', 'attached', 'kept_separate', 'superseded')),
  candidate_person_ids  uuid[]      NOT NULL DEFAULT '{}',
  submitted_email       text,
  submitted_phone       text,
  submitted_email_norm  text,
  submitted_phone_norm  text,
  created_by            uuid        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  resolved_by           uuid,
  resolved_at           timestamptz,
  resolution_reason     text,
  resolved_candidate_id uuid,
  -- Raw and normalized submitted identity exist only while a claim is open or was never a conflict.
  CONSTRAINT identity_claims_raw_only_while_open CHECK (
    status IN ('unique', 'open')
    OR (submitted_email IS NULL AND submitted_phone IS NULL
        AND submitted_email_norm IS NULL AND submitted_phone_norm IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_claims_status_idx ON public.identity_claims (status, created_at);

CREATE TABLE IF NOT EXISTS public.identity_review_audit (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_id     uuid        NOT NULL,
  action       text        NOT NULL CHECK (action IN ('attached', 'kept_separate', 'superseded')),
  actor_id     uuid        NOT NULL,
  reason       text        NOT NULL,
  candidate_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_read_audit (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid        NOT NULL,
  target_kind text        NOT NULL CHECK (target_kind IN ('claim', 'person')),
  target_id   uuid        NOT NULL,
  reason      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.identity_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_review_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_read_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.identity_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.identity_review_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.identity_read_audit FROM PUBLIC, anon, authenticated;

-- Audit rows are append-only. Neither a client nor the owner can rewrite history through normal statements.
CREATE OR REPLACE FUNCTION public._f2_refuse_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Audit records cannot be changed or removed.' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER identity_review_audit_append_only
  BEFORE UPDATE OR DELETE ON public.identity_review_audit
  FOR EACH ROW EXECUTE FUNCTION public._f2_refuse_audit_mutation();

CREATE TRIGGER identity_read_audit_append_only
  BEFORE UPDATE OR DELETE ON public.identity_read_audit
  FOR EACH ROW EXECUTE FUNCTION public._f2_refuse_audit_mutation();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Internal helpers (owner-only). No EXECUTE for PUBLIC, anon or authenticated.
-- ---------------------------------------------------------------------------------------------------------------------

-- Returns the caller's id when the caller has an ACTIVE profile. Any other caller gets 42501.
CREATE OR REPLACE FUNCTION public._f2_active_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'You cannot log contacts from this account.' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;

-- Returns the caller's id only for an ACTIVE admin or coordinator. current_user_role() filters on status = 'active'.
CREATE OR REPLACE FUNCTION public._f2_staff_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_coordinator() THEN
    RAISE EXCEPTION 'You are not authorised for identity review.' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE OR REPLACE FUNCTION public._f2_valid_reason(p_reason text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Give a reason (3 to 500 characters).' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- The single implementation of a contact submission for one row. Callers are the two public wrappers only.
-- It is SECURITY DEFINER and owned by postgres, so it may write people and contacts. Its EXECUTE privilege is
-- withheld from clients, so it cannot be called directly through PostgREST.
CREATE OR REPLACE FUNCTION public._f2_submit_contact_row(
  p_actor               uuid,
  p_contact_name        text,
  p_cell_id             uuid,
  p_contact_phone       text,
  p_email               text,
  p_phone_hidden        boolean,
  p_tag                 text,
  p_notes               text,
  p_follow_up_status    text,
  p_follow_up_assignee  uuid,
  p_date_contacted      date,
  p_is_member           boolean,
  p_idempotency_key     text
)
RETURNS TABLE (out_contact_id uuid, out_replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name           text := btrim(coalesce(p_contact_name, ''));
  v_phone          text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_email          text := nullif(btrim(coalesce(p_email, '')), '');
  v_email_norm     text;
  v_phone_norm     text;
  v_role           text;
  v_actor_cell     uuid;
  v_subject_id     uuid := gen_random_uuid();
  v_contact_id     uuid;
  v_existing_id    uuid;
  v_conflict       boolean;
  v_candidates     uuid[];
  v_date           date := coalesce(p_date_contacted, current_date);
BEGIN
  -- Validation depends only on the format of the input, never on stored identity.
  IF char_length(v_name) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'Enter a contact name (2 to 200 characters).' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND (
       char_length(v_email) > 320
    OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  ) THEN
    RAISE EXCEPTION 'Enter a valid email address.' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NOT NULL AND char_length(regexp_replace(v_phone, '\D', '', 'g')) NOT BETWEEN 7 AND 15 THEN
    RAISE EXCEPTION 'Enter a valid phone number.' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NOT NULL AND char_length(p_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'The submission key is invalid.' USING ERRCODE = '22023';
  END IF;

  -- Cell authorization. Mirrors contacts_insert_scoped. Every failure, including a nonexistent cell, returns 42501,
  -- so no foreign-key error can disclose cell existence.
  SELECT p.role, p.cell_id INTO v_role, v_actor_cell
    FROM public.profiles p
   WHERE p.id = p_actor AND p.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You cannot log contacts from this account.' USING ERRCODE = '42501';
  END IF;
  -- Idempotency comes before cell authorization and before any identity work. A repeated key returns the caller's own
  -- original contact even if the cell or the identity has changed since the first attempt. Nothing is written, and no
  -- person, claim or contact is created. The lookup is keyed on logged_by = caller, so it reveals nothing to others.
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('f2:idem:' || p_actor::text || ':' || p_idempotency_key, 0));
    SELECT c.id INTO v_existing_id
      FROM public.contacts c
     WHERE c.logged_by = p_actor AND c.idempotency_key = p_idempotency_key;
    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT v_existing_id, true;
      RETURN;
    END IF;
  END IF;

  IF p_cell_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cells c WHERE c.id = p_cell_id) THEN
    RAISE EXCEPTION 'You cannot log a contact in that cell.' USING ERRCODE = '42501';
  END IF;
  IF NOT (
       v_role IN ('admin', 'coordinator')
    OR p_cell_id IS NULL
    OR p_cell_id = v_actor_cell
    OR EXISTS (SELECT 1 FROM public.cells c WHERE c.id = p_cell_id AND c.leader_id = p_actor)
  ) THEN
    RAISE EXCEPTION 'You cannot log a contact in that cell.' USING ERRCODE = '42501';
  END IF;

  v_email_norm := public.normalize_identity_email(v_email);
  v_phone_norm := public.normalize_identity_phone(v_phone);

  -- Identity locks, in fixed order: email, then phone.
  IF v_email_norm IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('f2:email:' || v_email_norm, 0));
  END IF;
  IF v_phone_norm IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('f2:phone:' || v_phone_norm, 0));
  END IF;

  -- Conflict test over every person row, in every status. Runs as the owner, so visibility does not apply.
  SELECT coalesce(array_agg(p.id), '{}'::uuid[]) INTO v_candidates
    FROM public.people p
   WHERE (v_email_norm IS NOT NULL AND public.normalize_identity_email(p.email) = v_email_norm)
      OR (v_phone_norm IS NOT NULL AND public.normalize_identity_phone(p.phone) = v_phone_norm);
  v_conflict := cardinality(v_candidates) > 0;

  -- Subject person. Identity is stored only when there is no conflict. A unique_violation from a path the locks do
  -- not cover is caught in a subtransaction, treated as a conflict, and never reaches the caller.
  BEGIN
    INSERT INTO public.people (id, full_name, email, phone)
    VALUES (
      v_subject_id,
      v_name,
      CASE WHEN NOT v_conflict THEN v_email END,
      CASE WHEN NOT v_conflict THEN v_phone END
    );
  EXCEPTION WHEN unique_violation THEN
    v_conflict := true;
    SELECT coalesce(array_agg(p.id), '{}'::uuid[]) INTO v_candidates
      FROM public.people p
     WHERE (v_email_norm IS NOT NULL AND public.normalize_identity_email(p.email) = v_email_norm)
        OR (v_phone_norm IS NOT NULL AND public.normalize_identity_phone(p.phone) = v_phone_norm);
    INSERT INTO public.people (id, full_name) VALUES (v_subject_id, v_name);
  END;

  -- Contact. The existing idempotency index is the arbiter. A conflict here is impossible under the lock, so it is
  -- reported as a retryable serialization failure, which rolls back the whole submission.
  INSERT INTO public.contacts (
    cell_id, contact_name, contact_phone, phone_hidden, email, tag, notes,
    follow_up_status, follow_up_assignee, date_contacted, is_member,
    logged_by, idempotency_key, person_id, archived
  ) VALUES (
    p_cell_id, v_name, v_phone, coalesce(p_phone_hidden, false), v_email, p_tag, p_notes,
    coalesce(p_follow_up_status, ''), p_follow_up_assignee, v_date, coalesce(p_is_member, false),
    p_actor, p_idempotency_key, v_subject_id, false
  )
  ON CONFLICT (logged_by, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_contact_id;

  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'The submission could not be saved. Try again.' USING ERRCODE = '40001';
  END IF;

  -- Claim. Written on every submission so the write set is the same for matched and unmatched identities.
  -- Raw identity is kept only for an open conflict.
  INSERT INTO public.identity_claims (
    contact_id, subject_person_id, status, candidate_person_ids,
    submitted_email, submitted_phone, submitted_email_norm, submitted_phone_norm, created_by
  ) VALUES (
    v_contact_id,
    v_subject_id,
    CASE WHEN v_conflict THEN 'open' ELSE 'unique' END,
    v_candidates,
    CASE WHEN v_conflict THEN v_email END,
    CASE WHEN v_conflict THEN v_phone END,
    CASE WHEN v_conflict THEN v_email_norm END,
    CASE WHEN v_conflict THEN v_phone_norm END,
    p_actor
  );

  RETURN QUERY SELECT v_contact_id, false;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Client-callable contact submission.
-- ---------------------------------------------------------------------------------------------------------------------

-- Single submission. The response is the same for fresh, visible-match and hidden-match identities: a contact id and
-- the constant outcome 'logged'. logged_by is always auth.uid(); it is not a parameter.
CREATE OR REPLACE FUNCTION public.submit_contact(
  p_contact_name       text,
  p_cell_id            uuid,
  p_contact_phone      text DEFAULT NULL,
  p_email              text DEFAULT NULL,
  p_phone_hidden       boolean DEFAULT false,
  p_tag                text DEFAULT NULL,
  p_notes              text DEFAULT NULL,
  p_follow_up_status   text DEFAULT NULL,
  p_follow_up_assignee uuid DEFAULT NULL,
  p_date_contacted     date DEFAULT NULL,
  p_is_member          boolean DEFAULT false,
  p_idempotency_key    text DEFAULT NULL
)
RETURNS TABLE (contact_id uuid, outcome text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public._f2_active_actor();
  v_id    uuid;
BEGIN
  SELECT r.out_contact_id INTO STRICT v_id
    FROM public._f2_submit_contact_row(
      v_actor, p_contact_name, p_cell_id, p_contact_phone, p_email, p_phone_hidden, p_tag, p_notes,
      p_follow_up_status, p_follow_up_assignee, p_date_contacted, p_is_member, p_idempotency_key
    ) AS r;
  RETURN QUERY SELECT v_id, 'logged'::text;
END;
$$;

-- Batch submission for CSV import. Each row runs in its own exception subtransaction, so one failing row rolls back
-- only itself. The error codes carry no identity information.
CREATE OR REPLACE FUNCTION public.submit_contacts_batch(p_rows jsonb)
RETURNS TABLE (row_index int, outcome text, contact_id uuid, error_code text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public._f2_active_actor();
  v_count int;
  v_i     int;
  v_row   jsonb;
  v_id    uuid;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Send a list of contacts.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count > 500 THEN
    RAISE EXCEPTION 'Import at most 500 rows at a time.' USING ERRCODE = '22023';
  END IF;

  FOR v_i IN 0 .. v_count - 1 LOOP
    v_row := p_rows -> v_i;
    BEGIN
      SELECT r.out_contact_id INTO STRICT v_id
        FROM public._f2_submit_contact_row(
          v_actor,
          v_row ->> 'contact_name',
          nullif(v_row ->> 'cell_id', '')::uuid,
          v_row ->> 'contact_phone',
          v_row ->> 'email',
          coalesce((v_row ->> 'phone_hidden')::boolean, false),
          v_row ->> 'tag',
          v_row ->> 'notes',
          v_row ->> 'follow_up_status',
          nullif(v_row ->> 'follow_up_assignee', '')::uuid,
          nullif(v_row ->> 'date_contacted', '')::date,
          coalesce((v_row ->> 'is_member')::boolean, false),
          v_row ->> 'idempotency_key'
        ) AS r;
      row_index := v_i + 1;
      outcome := 'logged';
      contact_id := v_id;
      error_code := NULL;
      RETURN NEXT;
    EXCEPTION
      WHEN insufficient_privilege THEN
        row_index := v_i + 1; outcome := 'rejected'; contact_id := NULL; error_code := 'not_authorized';
        RETURN NEXT;
      WHEN serialization_failure THEN
        row_index := v_i + 1; outcome := 'rejected'; contact_id := NULL; error_code := 'retry';
        RETURN NEXT;
      WHEN invalid_parameter_value OR invalid_text_representation OR invalid_datetime_format
        OR datetime_field_overflow OR check_violation OR not_null_violation THEN
        row_index := v_i + 1; outcome := 'rejected'; contact_id := NULL; error_code := 'invalid';
        RETURN NEXT;
      WHEN OTHERS THEN
        row_index := v_i + 1; outcome := 'rejected'; contact_id := NULL; error_code := 'internal';
        RETURN NEXT;
    END;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Staff identity review. Admins and coordinators only (D2). Every identity read is audited with a reason.
-- ---------------------------------------------------------------------------------------------------------------------

-- Lists claims without any identity value. Candidates are shown by name only.
CREATE OR REPLACE FUNCTION public.list_identity_claims(
  p_status text DEFAULT 'open',
  p_limit  int DEFAULT 50
)
RETURNS TABLE (
  claim_id uuid,
  contact_id uuid,
  contact_name text,
  cell_id uuid,
  status text,
  candidate_person_ids uuid[],
  candidate_names text[],
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public._f2_staff_actor();
  IF p_status NOT IN ('open', 'unique', 'attached', 'kept_separate', 'superseded') THEN
    RAISE EXCEPTION 'Choose a valid review status.' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Choose between 1 and 200 rows.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT ic.id,
           ic.contact_id,
           c.contact_name,
           c.cell_id,
           ic.status,
           ic.candidate_person_ids,
           coalesce(
             (SELECT array_agg(p.full_name ORDER BY p.full_name)
                FROM public.people p
               WHERE p.id = ANY (ic.candidate_person_ids)),
             '{}'::text[]),
           ic.created_at
      FROM public.identity_claims ic
      JOIN public.contacts c ON c.id = ic.contact_id
     WHERE ic.status = p_status
     ORDER BY ic.created_at DESC
     LIMIT p_limit;
END;
$$;

-- Reveals the submitted identity of one OPEN claim. Audited.
CREATE OR REPLACE FUNCTION public.get_claim_identity(p_claim_id uuid, p_reason text)
RETURNS TABLE (submitted_email text, submitted_phone text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public._f2_staff_actor();
  v_email text;
  v_phone text;
BEGIN
  PERFORM public._f2_valid_reason(p_reason);
  SELECT ic.submitted_email, ic.submitted_phone INTO v_email, v_phone
    FROM public.identity_claims ic
   WHERE ic.id = p_claim_id AND ic.status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This review is no longer open.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.identity_read_audit (actor_id, target_kind, target_id, reason)
  VALUES (v_actor, 'claim', p_claim_id, btrim(p_reason));
  RETURN QUERY SELECT v_email, v_phone;
END;
$$;

-- Reveals a canonical person's identity. Audited.
CREATE OR REPLACE FUNCTION public.get_person_identity(p_person_id uuid, p_reason text)
RETURNS TABLE (full_name text, email text, phone text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public._f2_staff_actor();
  v_name  text;
  v_email text;
  v_phone text;
BEGIN
  PERFORM public._f2_valid_reason(p_reason);
  SELECT p.full_name, p.email, p.phone INTO v_name, v_email, v_phone
    FROM public.people p
   WHERE p.id = p_person_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Person not found.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.identity_read_audit (actor_id, target_kind, target_id, reason)
  VALUES (v_actor, 'person', p_person_id, btrim(p_reason));
  RETURN QUERY SELECT v_name, v_email, v_phone;
END;
$$;

-- Resolves one open claim exactly once. 'attach' merges the subject into a chosen candidate through merge_people.
-- 'keep_separate' closes the claim and leaves both people in place. Either way the raw identity is discarded.
CREATE OR REPLACE FUNCTION public.resolve_identity_claim(
  p_claim_id     uuid,
  p_decision     text,
  p_candidate_id uuid,
  p_reason       text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor    uuid := public._f2_staff_actor();
  v_claim    public.identity_claims%ROWTYPE;
  v_outcome  text;
BEGIN
  PERFORM public._f2_valid_reason(p_reason);
  IF p_decision NOT IN ('attach', 'keep_separate') THEN
    RAISE EXCEPTION 'Choose attach or keep_separate.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_claim FROM public.identity_claims ic WHERE ic.id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'open' THEN
    RAISE EXCEPTION 'This review is no longer open.' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision = 'attach' THEN
    IF p_candidate_id IS NULL OR NOT (p_candidate_id = ANY (v_claim.candidate_person_ids)) THEN
      RAISE EXCEPTION 'Choose one of the matching people.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.people p WHERE p.id = p_candidate_id)
       OR v_claim.subject_person_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.people p WHERE p.id = v_claim.subject_person_id) THEN
      v_outcome := 'superseded';
    ELSE
      PERFORM public.merge_people(p_candidate_id, v_claim.subject_person_id, btrim(p_reason));
      v_outcome := 'attached';
    END IF;
  ELSE
    v_outcome := 'kept_separate';
  END IF;

  UPDATE public.identity_claims ic
     SET status = v_outcome,
         resolved_by = v_actor,
         resolved_at = now(),
         resolution_reason = btrim(p_reason),
         resolved_candidate_id = CASE WHEN v_outcome = 'attached' THEN p_candidate_id END,
         submitted_email = NULL,
         submitted_phone = NULL,
         submitted_email_norm = NULL,
         submitted_phone_norm = NULL
   WHERE ic.id = p_claim_id;

  INSERT INTO public.identity_review_audit (claim_id, action, actor_id, reason, candidate_id)
  VALUES (p_claim_id, v_outcome, v_actor, btrim(p_reason),
          CASE WHEN v_outcome = 'attached' THEN p_candidate_id END);

  RETURN v_outcome;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Protection of contacts.person_id. Reassignment is an owner-only operation (merge_people runs as postgres).
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._f2_guard_contact_person()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'The person linked to a contact cannot be changed here.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_guard_person_reassignment ON public.contacts;
CREATE TRIGGER contacts_guard_person_reassignment
  BEFORE UPDATE OF person_id ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public._f2_guard_contact_person();

-- merge_people already pins its search_path. Align it with the other functions in this migration. Body unchanged.
ALTER FUNCTION public.merge_people(uuid, uuid, text) SET search_path = pg_catalog, public;

-- ---------------------------------------------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------------------------------
-- 5b. Attribution integrity (findings N2 and N3).
-- ---------------------------------------------------------------------------------------------------------------------

-- N2. The insert policy derived logged_by from the caller only for ordinary members. Admins, coordinators and cell
-- leaders could insert a contact attributed to any user. logged_by = auth.uid() now applies to every role. The scope
-- checks are otherwise unchanged. No client write path logs a contact for someone else.
DROP POLICY IF EXISTS contacts_insert_scoped ON public.contacts;
CREATE POLICY contacts_insert_scoped ON public.contacts
  FOR INSERT
  WITH CHECK (
    logged_by = auth.uid()
    AND (
         public.is_admin_or_coordinator()
      OR public.is_cell_leader_of(cell_id)
      OR (
           public.is_active_member()
           AND (cell_id IS NULL
                OR cell_id IS NOT DISTINCT FROM (SELECT p.cell_id FROM public.profiles p WHERE p.id = auth.uid()))
         )
    )
  );

-- N3. contacts.logged_by is owner-controlled. A client can not change it, even where the UPDATE policy would allow the
-- row to be edited. Corrections go through correct_contact_attribution below, which records who made the change and why.
CREATE OR REPLACE FUNCTION public._f2_guard_contact_logger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.logged_by IS DISTINCT FROM OLD.logged_by
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'The person who logged a contact cannot be changed here.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_guard_logger ON public.contacts;
CREATE TRIGGER contacts_guard_logger
  BEFORE UPDATE OF logged_by ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public._f2_guard_contact_logger();

CREATE TABLE IF NOT EXISTS public.contact_attribution_audit (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id      uuid        NOT NULL,
  old_logged_by   uuid        NOT NULL,
  new_logged_by   uuid        NOT NULL,
  actor_id        uuid        NOT NULL,
  reason          text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contact_attribution_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_attribution_audit FROM PUBLIC, anon, authenticated;
CREATE TRIGGER contact_attribution_audit_append_only
  BEFORE UPDATE OR DELETE ON public.contact_attribution_audit
  FOR EACH ROW EXECUTE FUNCTION public._f2_refuse_audit_mutation();

-- Privileged correction. Admin or coordinator only, with a reason. Writes one audit row in the same transaction.
CREATE OR REPLACE FUNCTION public.correct_contact_attribution(
  p_contact_id    uuid,
  p_new_logged_by uuid,
  p_reason        text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public._f2_staff_actor();
  v_old   uuid;
BEGIN
  PERFORM public._f2_valid_reason(p_reason);
  IF p_new_logged_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_new_logged_by) THEN
    RAISE EXCEPTION 'Choose an existing user.' USING ERRCODE = '22023';
  END IF;

  SELECT c.logged_by INTO v_old FROM public.contacts c WHERE c.id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_old = p_new_logged_by THEN
    RAISE EXCEPTION 'The contact already has that logger.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.contacts SET logged_by = p_new_logged_by WHERE id = p_contact_id;

  INSERT INTO public.contact_attribution_audit (contact_id, old_logged_by, new_logged_by, actor_id, reason)
  VALUES (p_contact_id, v_old, p_new_logged_by, v_actor, btrim(p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public._f2_guard_contact_logger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_contact_attribution(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_contact_attribution(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Function privileges. Start from no EXECUTE, then grant only the client-facing functions.
-- ---------------------------------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._f2_active_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._f2_staff_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._f2_valid_reason(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._f2_submit_contact_row(uuid, text, uuid, text, text, boolean, text, text, text, uuid, date, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._f2_refuse_audit_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._f2_guard_contact_person() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.submit_contact(text, uuid, text, text, boolean, text, text, text, uuid, date, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_contact(text, uuid, text, text, boolean, text, text, text, uuid, date, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_contacts_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_contacts_batch(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.list_identity_claims(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_identity_claims(text, int) TO authenticated;

REVOKE ALL ON FUNCTION public.get_claim_identity(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_claim_identity(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_person_identity(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_person_identity(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_identity_claim(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_identity_claim(uuid, text, uuid, text) TO authenticated;
