-- 073: the person behind a contact is resolved or created by the database, in the same write that creates the contact.
-- The browser no longer looks up people by email, so no caller can learn whether an email is on file. Non-staff writers
-- can never choose a person id: an insert is always linked to the person matching the contact's email, and an update may
-- not change the link. find_person_id_for_contact (072) is removed, since nothing needs it. Forward-only.

-- ─── Resolve or create the person for a contact (BEFORE INSERT and BEFORE UPDATE OF person_id) ─────────────────────────
create or replace function public.contacts_resolve_person()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_staff boolean;
  v_email text := nullif(btrim(new.email), '');
  v_person uuid;
begin
  -- Migration and service writers (no authenticated user) keep the person id they supply.
  if v_actor is null then
    return new;
  end if;

  v_staff := public.is_admin_or_coordinator();
  if not v_staff then
    if tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then
      raise exception 'the person linked to a contact cannot be changed' using errcode = '42501';
    end if;
    -- A client-supplied person id is never trusted from a non-staff writer.
    if tg_op = 'INSERT' then
      new.person_id := null;
    end if;
  end if;

  if new.person_id is not null then
    return new;  -- staff supplied an explicit link
  end if;

  if v_email is not null then
    select p.id into v_person
    from public.people p
    where public.normalize_identity_email(p.email) = public.normalize_identity_email(v_email)
    limit 1;
  end if;

  if v_person is null then
    begin
      insert into public.people (full_name, email, phone)
      values (new.contact_name, v_email, nullif(btrim(new.contact_phone), ''))
      returning id into v_person;
    exception when unique_violation then
      -- A concurrent writer created the same person. Link to that record, never a second one.
      select p.id into v_person
      from public.people p
      where public.normalize_identity_email(p.email) = public.normalize_identity_email(v_email)
      limit 1;
    end;
  end if;

  new.person_id := v_person;
  return new;
end;
$$;

revoke all on function public.contacts_resolve_person() from public, anon, authenticated;

drop trigger if exists contacts_resolve_person on public.contacts;
create trigger contacts_resolve_person
  before insert or update of person_id on public.contacts
  for each row execute function public.contacts_resolve_person();

-- ─── Remove the email lookup for contact logging ────────────────────────────────────────────────────────────────────────
drop function if exists public.find_person_id_for_contact(text);
