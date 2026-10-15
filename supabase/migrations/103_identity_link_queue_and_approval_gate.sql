-- 103_identity_link_queue_and_approval_gate.sql
--
-- Staff identity-linking queue for existing members, and an approval gate for accounts that still need linking.
-- Forward-only. Migrations 000-102 are not modified. No existing profile, person or link row is rewritten.
--
-- Builds on 099 (signup never links; link_pending_profile_to_person is the only client link path) and on 016
-- (approve_pending_member). Contract added here:
--   * A pending account with no linked person whose normalised email matches an existing person "needs linking".
--     It is listed in the staff queue (list_identity_link_queue) and CANNOT be approved until it is linked.
--   * Staff review a candidate through get_person_identity (097), which is reason-gated and audited in
--     identity_read_audit. This migration does not add a second reveal path.
--   * link_pending_profile_to_person (099) additionally refuses an account with a PENDING EMAIL CHANGE
--     (auth.users.email_change, the GoTrue column that holds the pending new address; the old email stays in
--     auth.users.email until the change is confirmed). Such an account cannot be linked until that change resolves.
--   * approve_pending_member writes an append-only approval audit row for every activation.
--   * Only administrators and coordinators reach the queue, the link and the approval (_f2_staff_actor, 097).
--
-- Not decided here: the retention period for queue rows (the queue is derived, not stored, so nothing is retained).

-- ─── 1. Masking helper for queue output (no full email leaves the database in the list) ──────────────────────────────

create or replace function public._mask_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(split_part(p_email, '@', 1), 1)
         || repeat('*', 3)
         || substring(p_email from position('@' in p_email))
  end
$$;

revoke all on function public._mask_email(text) from public, anon, authenticated;

-- ─── 1b. Pending email change: GoTrue keeps the NEW address in auth.users.email_change until it is confirmed ────────────
-- (email_change is the column; "new_email" is a field of GoTrue's API JSON, not a database column.)

create or replace function public._auth_has_pending_email_change(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_user_id
       and nullif(btrim(u.email_change), '') is not null
  )
$$;

revoke all on function public._auth_has_pending_email_change(uuid) from public, anon, authenticated;

-- ─── 2. Approval audit (append-only, no client access) ───────────────────────────────────────────────────────────────

create table if not exists public.profile_approval_audit (
  id          bigint      generated always as identity primary key,
  profile_id  uuid        not null,
  actor_id    uuid        not null,
  action      text        not null check (action in ('approve')),
  created_at  timestamptz not null default now()
);

alter table public.profile_approval_audit enable row level security;
revoke all on table public.profile_approval_audit from public, anon, authenticated, service_role;

drop trigger if exists profile_approval_audit_append_only on public.profile_approval_audit;
create trigger profile_approval_audit_append_only
  before update or delete on public.profile_approval_audit
  for each row execute function public._f2_refuse_audit_mutation();

-- ─── 3. Approval gate: an account that needs linking cannot be approved (replaces 016 approve_pending_member) ─────────

create or replace function public.approve_pending_member(target_member_id uuid)
returns table (id uuid, email text, full_name text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_admin_or_coordinator() then
    raise exception 'Not authorised to approve members.' using errcode = '42501';
  end if;

  -- Serialise with link_pending_profile_to_person (which locks the same profile row): the gate below and the
  -- activation then see one consistent state, so an account cannot be approved in the gap before its link commits.
  perform 1 from public.profiles p where p.id = target_member_id for update;

  if exists (
    select 1
      from public.profiles p
     where p.id = target_member_id
       and p.status = 'pending'
       and p.person_id is null
       and exists (
         select 1 from public.people pe
          where public.normalize_identity_email(pe.email) = public.normalize_identity_email(p.email)
       )
  ) then
    raise exception 'Link this account to its existing person before approving it.' using errcode = '42501';
  end if;

  return query
  with approved as (
    update public.profiles p
       set status = 'active',
           updated_at = now()
     where p.id = target_member_id
       and p.status = 'pending'
    returning p.id, p.email, p.full_name, p.status
  ), audited as (
    insert into public.profile_approval_audit (profile_id, actor_id, action)
    select a.id, v_actor, 'approve' from approved a
    returning profile_id
  )
  select a.id, a.email, a.full_name, a.status
    from approved a
   where a.id in (select profile_id from audited);
end;
$$;

-- ─── 4. Link RPC: refuse pending email changes (replaces 099 link_pending_profile_to_person, same signature) ───────────

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
  v_auth_email     text;
  v_auth_confirmed boolean;
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

  -- One account per person, whatever that account's status.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.person_id = p_person_id) THEN
    RAISE EXCEPTION 'That person already has an account.' USING ERRCODE = 'P0001';
  END IF;

  -- Verified ownership: the confirmed auth email must equal the person's email.
  SELECT u.email, (u.email_confirmed_at IS NOT NULL)
    INTO v_auth_email, v_auth_confirmed
    FROM auth.users u
   WHERE u.id = p_profile_id;

  IF NOT FOUND OR NOT COALESCE(v_auth_confirmed, false) OR v_auth_email IS NULL
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

revoke all on function public.link_pending_profile_to_person(uuid, uuid, text) from public, anon;
grant execute on function public.link_pending_profile_to_person(uuid, uuid, text) to authenticated;

-- ─── 5. The staff queue: pending, unlinked accounts whose email matches an existing person ──────────────────────────

create or replace function public.list_identity_link_queue(p_limit integer default 100)
returns table (
  profile_id            uuid,
  profile_name          text,
  profile_masked_email  text,
  joined_at             timestamptz,
  email_verified        boolean,
  pending_email_change  boolean,
  candidate_person_id   uuid,
  candidate_name        text,
  candidate_masked_email text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public._f2_staff_actor();
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Choose between 1 and 200 rows.' using errcode = '22023';
  end if;

  return query
    select p.id,
           p.full_name,
           public._mask_email(p.email),
           p.joined_at,
           (u.email_confirmed_at is not null),
           public._auth_has_pending_email_change(p.id),
           pe.id,
           pe.full_name,
           public._mask_email(pe.email)
      from public.profiles p
      join public.people pe
        on public.normalize_identity_email(pe.email) = public.normalize_identity_email(p.email)
      left join auth.users u on u.id = p.id
     where p.status = 'pending'
       and p.person_id is null
     order by p.joined_at asc
     limit p_limit;
end;
$$;

revoke all on function public.list_identity_link_queue(integer) from public, anon;
grant execute on function public.list_identity_link_queue(integer) to authenticated;
