-- 100_membership_rpc_and_read_policy.sql
--
-- Forward-only. Extracted from the section 7 that 09a9eef appended to 098, so 098 stays byte-identical to its committed content.
-- Depends on 097 (_f2_staff_actor), 098 (membership grants and the 015/022 membership policy), 099 (none). Changes nothing earlier.


-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Membership writes go through transactional RPCs only. Direct writes by any API role are revoked, so the history in
-- membership_transitions can be written only together with the change it records, and performed_by is always the caller.
-- Reads: staff (admin or coordinator) see every membership. An ACTIVE member sees only their own. Pending, rejected and
-- inactive accounts see none. The policy 015 gave to every active member (any membership of anyone) is replaced.
-- ---------------------------------------------------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON TABLE public.memberships FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.membership_transitions FROM PUBLIC, anon, authenticated;

-- The person linked to the caller, but only while the caller is an active account. Used by the read policy.
CREATE OR REPLACE FUNCTION public._f2_caller_person_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.person_id FROM public.profiles p WHERE p.id = auth.uid() AND p.status = 'active';
$$;

DROP POLICY IF EXISTS memberships_read ON public.memberships;
CREATE POLICY memberships_read ON public.memberships
  FOR SELECT USING (public.is_core_admin() OR person_id = public._f2_caller_person_id());

-- Establish a membership for a person: staff only. One transaction: the membership, its transition, and the contact flag.
CREATE OR REPLACE FUNCTION public.establish_membership(
  p_person_id uuid,
  p_status    text,
  p_role      text,
  p_cell_id   uuid,
  p_notes     text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public._f2_staff_actor();
  v_id    uuid;
BEGIN
  IF p_status NOT IN ('active', 'pending') THEN
    RAISE EXCEPTION 'Choose active or pending.' USING ERRCODE = '22023';
  END IF;
  IF p_role NOT IN ('member', 'cell_leader', 'admin', 'coordinator') THEN
    RAISE EXCEPTION 'Choose a valid role.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.people p WHERE p.id = p_person_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Person not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.memberships (person_id, role, status, cell_id)
  VALUES (p_person_id, p_role, p_status, p_cell_id)
  RETURNING id INTO v_id;

  INSERT INTO public.membership_transitions (person_id, from_type, to_type, performed_by, notes)
  VALUES (p_person_id, 'contact',
          CASE WHEN p_status = 'pending' THEN 'pending_membership' ELSE 'member' END,
          v_actor, nullif(btrim(coalesce(p_notes, '')), ''));

  UPDATE public.contacts SET is_member = true WHERE person_id = p_person_id;
  RETURN v_id;
END;
$$;

-- Move an existing membership along the allowed path. Staff only. Pending -> active or rejected; active -> inactive.
CREATE OR REPLACE FUNCTION public.transition_membership(
  p_membership_id uuid,
  p_to_status     text,
  p_notes         text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := public._f2_staff_actor();
  m       public.memberships%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT ((m.status = 'pending' AND p_to_status IN ('active', 'rejected'))
       OR (m.status = 'active' AND p_to_status = 'inactive')) THEN
    RAISE EXCEPTION 'That membership change is not allowed.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.memberships SET status = p_to_status WHERE id = p_membership_id;

  INSERT INTO public.membership_transitions (person_id, from_type, to_type, performed_by, notes)
  VALUES (m.person_id, m.status, p_to_status, v_actor, nullif(btrim(coalesce(p_notes, '')), ''));
END;
$$;

ALTER FUNCTION public._f2_caller_person_id() OWNER TO postgres;
ALTER FUNCTION public.establish_membership(uuid, text, text, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.transition_membership(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._f2_caller_person_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._f2_caller_person_id() TO authenticated;
REVOKE ALL ON FUNCTION public.establish_membership(uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.establish_membership(uuid, text, text, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.transition_membership(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_membership(uuid, text, text) TO authenticated;

-- The default privileges of the owner grant EXECUTE to service_role on new functions. The membership functions and their
-- helper are client-callable by authenticated staff only, so service_role is withdrawn explicitly.
REVOKE EXECUTE ON FUNCTION public._f2_caller_person_id() FROM service_role;
REVOKE EXECUTE ON FUNCTION public.establish_membership(uuid, text, text, uuid, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.transition_membership(uuid, text, text) FROM service_role;
