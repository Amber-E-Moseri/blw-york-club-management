-- 106_fix_submit_contact_cell_scope.sql
--
-- Security remediation (forward-only). Migrations 000-105 are not modified.
--
-- Defect. The cell-scope check in _f2_submit_contact_row (097) read:
--     p_cell_id IS NULL OR p_cell_id = v_actor_cell OR EXISTS (leader of p_cell_id)
-- v_actor_cell is NULL for an account with no assigned cell. The comparison is then NULL, the disjunction is NULL, and
-- NOT (... ) is NULL, so the RAISE never runs. Any active account with no cell (a member or a cell leader) could log a
-- contact into any cell. Reproduced on the full replay: unassigned leader and unassigned member both accepted in a
-- foreign cell.
--
-- Fix. The own-cell disjunct is guarded so that every disjunct is a non-NULL boolean:
--     (v_actor_cell IS NOT NULL AND p_cell_id = v_actor_cell)
-- Everything else in the function is the 097 definition, copied unchanged: identity resolution and claims, idempotency,
-- audit fields (logged_by, idempotency_key), permission checks, follow-up assignee checks and the return values. CREATE OR
-- REPLACE keeps the owner, the search_path, and the grants that 097 set.
--
-- Allowed after this migration: administrator and coordinator; a null cell (unassigned workflow); the caller's own cell
-- (assigned member or leader); a cell the caller leads. Refused: any other cell, with SQLSTATE 42501, for every caller.

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
  p_idempotency_key     text,
  p_tag_names           text[] DEFAULT NULL,
  p_record_follow_up    boolean DEFAULT false
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
    OR (v_actor_cell IS NOT NULL AND p_cell_id = v_actor_cell)
    OR EXISTS (SELECT 1 FROM public.cells c WHERE c.id = p_cell_id AND c.leader_id = p_actor)
  ) THEN
    RAISE EXCEPTION 'You cannot log a contact in that cell.' USING ERRCODE = '42501';
  END IF;

  -- Follow-up assignee. Accepted only when the caller can see that profile under profiles_select_scoped: the caller
  -- themself, any profile for an admin or coordinator, or a profile in a cell the caller leads. A nonexistent profile
  -- and a hidden one get the same error, so the FK check below can not be used to probe profile existence.
  IF p_follow_up_assignee IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles pa
     WHERE pa.id = p_follow_up_assignee
       AND (
            pa.id = p_actor
         OR public.is_admin_or_coordinator()
         OR (public.is_cell_leader_for_profile(pa.id) AND pa.status IS DISTINCT FROM 'pending')
       )
  ) THEN
    RAISE EXCEPTION 'The follow-up assignee could not be set.' USING ERRCODE = '22023';
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

  -- Tags and the optional follow-up are written in the SAME subtransaction as the contact. A row is therefore either
  -- complete (contact, tags and follow-up) or absent. A replayed key returns early above and writes none of these again.
  IF p_tag_names IS NOT NULL THEN
    INSERT INTO public.contact_tags (contact_id, tag_name, tag_color, tagged_by)
    SELECT v_contact_id, t.name, '#cccccc', p_actor
      FROM (SELECT DISTINCT btrim(x) AS name FROM unnest(p_tag_names) AS x) t
     WHERE t.name <> '';
  END IF;
  IF p_record_follow_up AND p_follow_up_assignee IS NOT NULL THEN
    INSERT INTO public.contact_follow_ups (contact_id, assigned_to, assigned_by, assigned_on, status, notes, updated_at)
    VALUES (v_contact_id, p_follow_up_assignee, p_actor, now(), 'active', 'Assigned during bulk import', now());
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
