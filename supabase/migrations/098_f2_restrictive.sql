-- 098_f2_restrictive.sql
--
-- F2 remediation, RESTRICTIVE. Applies only after 097 and after the frontend has switched every contact write to
-- submit_contact / submit_contacts_batch and every identity read to the staff functions.
--
-- Effects:
--   * Ordinary members (authenticated) lose direct INSERT on people and contacts, so no PostgREST insert, upsert or
--     on_conflict request reaches a constraint.
--   * contacts UPDATE is column-scoped. person_id, logged_by, idempotency_key, id and created_at are not writable by
--     clients.
--   * people.email and people.phone are no longer readable by authenticated clients. Staff read them through
--     get_person_identity, which is audited.
--   * find_person_by_email is no longer executable by clients. It was the RLS-filtered lookup used by the old path.
--
-- Rollback: see the rollback notes in the release report. Re-granting these privileges reopens the F2 oracle, so a
-- rollback is an incident decision, not a routine step.

-- 1. Direct inserts. Members create people and contacts only through submit_contact / submit_contacts_batch.
REVOKE INSERT ON TABLE public.people FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON TABLE public.contacts FROM PUBLIC, anon, authenticated;

-- 2. contacts UPDATE, column-scoped. Table-level UPDATE is withdrawn first so the column grant is the only path.
--    The list is exactly the fields the client edits: ContactForm, archive, follow-up assignment, cell moves and the
--    membership bridge. person_id, logged_by, idempotency_key, id, created_at and updated_at are deliberately absent.
REVOKE UPDATE ON TABLE public.contacts FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  cell_id,
  contact_name,
  contact_phone,
  phone_hidden,
  email,
  tag,
  follow_up_status,
  follow_up_assignee,
  date_contacted,
  notes,
  is_member,
  member_id,
  archived
) ON TABLE public.contacts TO authenticated;

-- 3. Canonical identity. Members keep the row (id, full_name, timestamps) and lose identity columns.
REVOKE SELECT ON TABLE public.people FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, full_name, created_at, updated_at) ON TABLE public.people TO authenticated;

-- 4. The lookup RPC used by the old resolution path. Nothing client-side calls it after the switch.
REVOKE EXECUTE ON FUNCTION public.find_person_by_email(text) FROM PUBLIC, anon, authenticated;
