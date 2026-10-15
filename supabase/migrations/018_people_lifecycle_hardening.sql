-- People lifecycle hardening.
-- Keeps ONE HUMAN = ONE public.people row while allowing lifecycle history:
-- contact -> follow-up -> candidate -> pending -> active/rejected/reapply.

CREATE OR REPLACE FUNCTION public.normalize_identity_email(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(trim(value)), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_identity_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(coalesce(value, ''), '\D', '', 'g'), '');
$$;

-- Existing unique indexes were case/raw-string sensitive. These indexes make
-- identity uniqueness match product behavior without merging by name alone.
CREATE UNIQUE INDEX IF NOT EXISTS people_email_normalized_unique
  ON public.people (public.normalize_identity_email(email))
  WHERE public.normalize_identity_email(email) IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS people_phone_normalized_unique
  ON public.people (public.normalize_identity_phone(phone))
  WHERE public.normalize_identity_phone(phone) IS NOT NULL;

-- Store rejected applications as history and allow a later reapplication.
ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_status_check;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_check
    CHECK (status IN ('active', 'pending', 'inactive', 'rejected'));

-- The original constraint was UNIQUE (person_id, status), which accidentally
-- blocked more than one rejected/inactive historical row. Enforce only current
-- open states.
ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_one_active;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_active_per_person
  ON public.memberships (person_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_pending_per_person
  ON public.memberships (person_id)
  WHERE status = 'pending';

-- Safe manual merge for ambiguous identities. Contact rows, follow-ups, tags,
-- notes, contact audit, profiles, memberships, and transition history are all
-- preserved by repointing their person_id to the surviving person.
CREATE OR REPLACE FUNCTION public.merge_people(
  target_person_id uuid,
  source_person_id uuid,
  merge_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  target_exists boolean;
  source_exists boolean;
  source_email text;
  source_phone text;
BEGIN
  IF actor_id IS NULL OR NOT public.is_admin_or_coordinator() THEN
    RAISE EXCEPTION 'Not authorised to merge people.';
  END IF;

  IF target_person_id = source_person_id THEN
    RAISE EXCEPTION 'Cannot merge a person into themselves.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.people WHERE id = target_person_id)
    INTO target_exists;
  SELECT EXISTS (SELECT 1 FROM public.people WHERE id = source_person_id)
    INTO source_exists;

  IF NOT target_exists OR NOT source_exists THEN
    RAISE EXCEPTION 'Both target and source people must exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.memberships tm
    JOIN public.memberships sm ON sm.person_id = source_person_id
    WHERE tm.person_id = target_person_id
      AND tm.status = 'active'
      AND sm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot merge people with two active memberships.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.memberships tm
    JOIN public.memberships sm ON sm.person_id = source_person_id
    WHERE tm.person_id = target_person_id
      AND tm.status = 'pending'
      AND sm.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Cannot merge people with two pending memberships.';
  END IF;

  SELECT email, phone
  INTO source_email, source_phone
  FROM public.people
  WHERE id = source_person_id;

  UPDATE public.people
  SET email = NULL,
      phone = NULL,
      updated_at = now()
  WHERE id = source_person_id;

  UPDATE public.people target
  SET
    email = COALESCE(target.email, source_email),
    phone = COALESCE(target.phone, source_phone),
    updated_at = now()
  WHERE target.id = target_person_id
    AND NOT EXISTS (
      SELECT 1 FROM public.people other
      WHERE other.id <> target_person_id
        AND (
          (
            target.email IS NULL
            AND source_email IS NOT NULL
            AND public.normalize_identity_email(other.email) = public.normalize_identity_email(source_email)
          )
          OR (
            target.phone IS NULL
            AND source_phone IS NOT NULL
            AND public.normalize_identity_phone(other.phone) = public.normalize_identity_phone(source_phone)
          )
        )
    );

  UPDATE public.contacts
  SET person_id = target_person_id
  WHERE person_id = source_person_id;

  UPDATE public.profiles
  SET person_id = target_person_id
  WHERE person_id = source_person_id;

  UPDATE public.memberships
  SET person_id = target_person_id
  WHERE person_id = source_person_id;

  UPDATE public.membership_transitions
  SET person_id = target_person_id
  WHERE person_id = source_person_id;

  INSERT INTO public.membership_transitions (
    person_id,
    from_type,
    to_type,
    performed_by,
    notes
  )
  VALUES (
    target_person_id,
    'merge',
    'person',
    actor_id,
    COALESCE(merge_notes, 'Merged duplicate person ' || source_person_id::text)
  );

  DELETE FROM public.people
  WHERE id = source_person_id;

  RETURN target_person_id;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_people(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_people(uuid, uuid, text) TO authenticated;
