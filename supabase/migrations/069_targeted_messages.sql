-- 067_targeted_messages.sql
--
-- Owner workstream: Targeted messages (communications)
-- Dependencies:    016 (is_admin_or_coordinator), 022 (is_active_member), 059 (audience_specs, resolve_audience,
--                  saved_groups), 036 (is_active_profile)
-- Contract ref:    docs/ops-shared-contracts.md §1–4 (messages are a send-time snapshot), §8 (permission matrix)
--
-- Introduces:
--   1. public.communication_messages   one row per send (subject, body, sender, audience spec, channels)
--   2. public.communication_recipients  the frozen recipient snapshot, one row per (message, person)
--   3. public.communication_deliveries  per (message, person, channel) outcome
--   4. public.communication_audit       one row per privileged send
--   5. Functions: preview_audience, send_message, mark_message_read, and two visibility helpers for RLS
--
-- Delivery model: the send_message transaction writes the inbox (the recipient row plus an 'inbox' delivery marked
-- 'stored'). Email and push rows start as 'pending'. The dispatch-message edge function delivers them later and
-- records 'accepted' or 'failed'. A stored inbox row is NOT external delivery.
--
-- Authorization: enforced here, in the database, on every write path. Client checks are advisory only.
--   admin / coordinator: any audience (all, cells, saved_groups, explicit).
--   cell_leader:         mode 'cells' with exactly one cell, which must be the leader's own profiles.cell_id.
--   everyone else:       denied. Pending and rejected accounts are denied and can read nothing here.
-- Recipients are re-resolved through resolve_audience_all() (066), which only returns active profiles.

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.communication_messages (
  id                 uuid        primary key default gen_random_uuid(),
  sender_id          uuid        not null references public.profiles(id),
  sender_role        text        not null check (sender_role in ('admin','coordinator','cell_leader')),
  subject            text        not null check (char_length(btrim(subject)) between 1 and 200),
  body               text        not null check (char_length(btrim(body)) between 1 and 10000),
  audience_spec_id   uuid        not null references public.audience_specs(id),
  channels           text[]      not null
                       check (channels @> array['inbox']::text[] and channels <@ array['inbox','email','push']::text[]),
  recipient_count    integer     not null check (recipient_count >= 1),
  idempotency_key    uuid        not null,
  created_at         timestamptz not null default now(),
  unique (sender_id, idempotency_key)
);

create index if not exists communication_messages_sender_idx on public.communication_messages (sender_id, created_at desc);

create table if not exists public.communication_recipients (
  message_id   uuid        not null references public.communication_messages(id) on delete cascade,
  user_id      uuid        not null references public.profiles(id),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists communication_recipients_user_idx on public.communication_recipients (user_id);

create table if not exists public.communication_deliveries (
  message_id   uuid        not null,
  user_id      uuid        not null references public.profiles(id),
  channel      text        not null check (channel in ('inbox','email','push')),
  status       text        not null
                 check (status in ('pending','sending','stored','accepted','failed','skipped')),
  reason       text,
  attempts     integer     not null default 0 check (attempts >= 0),
  retryable    boolean     not null default false,
  provider_ref text,
  attempted_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (message_id, user_id, channel),
  foreign key (message_id, user_id)
    references public.communication_recipients(message_id, user_id) on delete cascade,
  -- 'stored' and 'accepted' are never 'delivered'. Only 'inbox' may be 'stored'.
  constraint communication_deliveries_stored_inbox_only
    check (status <> 'stored' or channel = 'inbox'),
  constraint communication_deliveries_accepted_external_only
    check (status <> 'accepted' or channel in ('email','push'))
);

drop trigger if exists communication_deliveries_updated_at on public.communication_deliveries;
create trigger communication_deliveries_updated_at
  before update on public.communication_deliveries
  for each row execute function public.set_updated_at();

create table if not exists public.communication_audit (
  id              uuid        primary key default gen_random_uuid(),
  message_id      uuid        not null references public.communication_messages(id) on delete cascade,
  actor_id        uuid        not null references public.profiles(id),
  actor_role      text        not null,
  action          text        not null check (action in ('send','dispatch')),
  audience_mode   text        not null check (audience_mode in ('all','cells','saved_groups','explicit')),
  recipient_count integer     not null check (recipient_count >= 0),
  created_at      timestamptz not null default now()
);

-- ─── 2. Visibility helpers (definer context, so RLS policies do not recurse into each other) ───

create or replace function public.is_message_sender(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.communication_messages m
    where m.id = p_message_id and m.sender_id = auth.uid()
  );
$$;

create or replace function public.is_message_recipient(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_member() and exists (
    select 1 from public.communication_recipients r
    where r.message_id = p_message_id and r.user_id = auth.uid()
  );
$$;

-- ─── 3. Row-level security ───────────────────────────────────────────────────

alter table public.communication_messages   enable row level security;
alter table public.communication_recipients enable row level security;
alter table public.communication_deliveries enable row level security;
alter table public.communication_audit      enable row level security;

-- Messages: the sender, staff, and the people in the snapshot. Nobody else, including excluded members.
drop policy if exists communication_messages_select on public.communication_messages;
create policy communication_messages_select on public.communication_messages
  for select
  using (
    public.is_admin_or_coordinator()
    or public.is_message_sender(id)
    or public.is_message_recipient(id)
  );

-- Recipients: an active member sees only their own rows. The sender and staff see the whole snapshot.
drop policy if exists communication_recipients_select on public.communication_recipients;
create policy communication_recipients_select on public.communication_recipients
  for select
  using (
    public.is_admin_or_coordinator()
    or public.is_message_sender(message_id)
    or (user_id = auth.uid() and public.is_active_member())
  );

-- Only the owner of a recipient row may mark it read, and only through mark_message_read().
-- No direct insert, update or delete policy exists for any client role.

drop policy if exists communication_deliveries_select on public.communication_deliveries;
create policy communication_deliveries_select on public.communication_deliveries
  for select
  using (
    public.is_admin_or_coordinator()
    or public.is_message_sender(message_id)
    or (user_id = auth.uid() and public.is_active_member())
  );

drop policy if exists communication_audit_select on public.communication_audit;
create policy communication_audit_select on public.communication_audit
  for select
  using (public.is_admin_or_coordinator());

-- ─── 4. Privileges ───────────────────────────────────────────────────────────

revoke all on public.communication_messages, public.communication_recipients,
  public.communication_deliveries, public.communication_audit from public, anon;

grant select on public.communication_messages   to authenticated;
grant select on public.communication_recipients to authenticated;
grant select on public.communication_deliveries to authenticated;
grant select on public.communication_audit      to authenticated;

-- The dispatcher (service_role) records outcomes. It is the only writer of deliveries after send.
grant select, insert, update, delete on public.communication_messages, public.communication_recipients,
  public.communication_deliveries, public.communication_audit to service_role;

-- ─── 5. Authorization and audience checks ────────────────────────────────────

-- Raises if the caller may not send to this audience. Used by preview_audience and send_message.
create or replace function public.assert_can_send_message(
  p_mode        text,
  p_cell_ids    uuid[],
  p_group_ids   uuid[],
  p_profile_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if not found or v_profile.status <> 'active' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  if p_mode not in ('all','cells','saved_groups','explicit') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;

  if v_profile.role in ('admin','coordinator') then
    null; -- any audience
  elsif v_profile.role = 'cell_leader' then
    if p_mode <> 'cells' or v_profile.cell_id is null then
      raise exception 'not_authorised' using errcode = '42501';
    end if;
    if coalesce(cardinality(p_cell_ids), 0) <> 1 or p_cell_ids[1] <> v_profile.cell_id then
      raise exception 'outside_cell' using errcode = '42501';
    end if;
  else
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- Every named target must exist. An unknown id is an error, not a silent drop.
  if p_mode = 'cells' and exists (
    select 1 from unnest(p_cell_ids) as c(id)
    where not exists (select 1 from public.cells where cells.id = c.id)
  ) then
    raise exception 'unknown_cell' using errcode = '22023';
  end if;
  if p_mode = 'saved_groups' and exists (
    select 1 from unnest(p_group_ids) as g(id)
    where not exists (select 1 from public.saved_groups sg where sg.id = g.id and sg.is_active)
  ) then
    raise exception 'unknown_group' using errcode = '22023';
  end if;
  if p_mode = 'explicit' and exists (
    select 1 from unnest(p_profile_ids) as p(id)
    where not exists (select 1 from public.profiles where profiles.id = p.id)
  ) then
    raise exception 'unknown_recipient' using errcode = '22023';
  end if;
end;
$$;

-- ─── 6. Preview: what would this audience reach? ─────────────────────────────

-- Returns the active recipients the caller may address, for the composer's preview step.
-- Creates one audience_specs row so resolve_audience_all() stays the only resolution path. Specs are immutable and tiny.
create or replace function public.preview_audience(
  p_mode        text,
  p_cell_ids    uuid[] default null,
  p_group_ids   uuid[] default null,
  p_profile_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spec uuid;
  v_result jsonb;
begin
  perform public.assert_can_send_message(p_mode, p_cell_ids, p_group_ids, p_profile_ids);

  insert into public.audience_specs (mode, cell_ids, group_ids, profile_ids, created_by)
  values (
    p_mode,
    case when p_mode = 'cells' then p_cell_ids end,
    case when p_mode = 'saved_groups' then p_group_ids end,
    case when p_mode = 'explicit' then p_profile_ids end,
    auth.uid()
  )
  returning id into v_spec;

  select jsonb_build_object(
    'recipients', coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'cellId', p.cell_id)
                                     order by p.full_name), '[]'::jsonb),
    'count', count(*)
  )
  into v_result
  from public.profiles p
  where p.id in (select profile_id from public.resolve_audience_all(v_spec));

  return v_result;
end;
$$;

-- ─── 7. Send: the authenticated, transactional write path ────────────────────

-- One transaction: validates, resolves, snapshots, writes inbox rows and queues external deliveries, then audits.
-- Idempotent on (sender, idempotency_key): a retry returns the original message id and writes nothing new.
create or replace function public.send_message(
  p_subject         text,
  p_body            text,
  p_mode            text,
  p_cell_ids        uuid[],
  p_group_ids       uuid[],
  p_profile_ids     uuid[],
  p_channels        text[],
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_existing uuid;
  v_spec    uuid;
  v_message uuid := gen_random_uuid();
  v_count   integer;
  v_channel text;
begin
  select id into v_existing from public.communication_messages
    where sender_id = v_uid and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  perform public.assert_can_send_message(p_mode, p_cell_ids, p_group_ids, p_profile_ids);

  select role into v_role from public.profiles where id = v_uid;

  if p_channels is null or not (p_channels @> array['inbox']::text[])
     or not (p_channels <@ array['inbox','email','push']::text[]) then
    raise exception 'invalid_channels' using errcode = '22023';
  end if;

  -- External email and push broadcasts are staff-only until separately approved. Leaders send internal messages.
  if (p_channels && array['email','push']::text[]) and v_role not in ('admin','coordinator') then
    raise exception 'external_channels_restricted' using errcode = '42501';
  end if;

  insert into public.audience_specs (mode, cell_ids, group_ids, profile_ids, created_by)
  values (
    p_mode,
    case when p_mode = 'cells' then p_cell_ids end,
    case when p_mode = 'saved_groups' then p_group_ids end,
    case when p_mode = 'explicit' then p_profile_ids end,
    v_uid
  )
  returning id into v_spec;

  select count(distinct profile_id) into v_count from public.resolve_audience_all(v_spec);
  if v_count = 0 then
    raise exception 'empty_audience' using errcode = '22023';
  end if;

  insert into public.communication_messages (
    id, sender_id, sender_role, subject, body, audience_spec_id, channels, recipient_count, idempotency_key
  ) values (
    v_message, v_uid, v_role, btrim(p_subject), btrim(p_body), v_spec, p_channels, v_count, p_idempotency_key
  );

  -- Snapshot. A person is recorded once, even if several selected groups or cells contain them.
  insert into public.communication_recipients (message_id, user_id)
  select v_message, profile_id from (select distinct profile_id from public.resolve_audience_all(v_spec)) r;

  -- Inbox is written in this transaction, so it is stored or not at all.
  insert into public.communication_deliveries (message_id, user_id, channel, status, attempted_at)
  select v_message, user_id, 'inbox', 'stored', now()
  from public.communication_recipients where message_id = v_message;

  foreach v_channel in array p_channels loop
    if v_channel <> 'inbox' then
      insert into public.communication_deliveries (message_id, user_id, channel, status)
      select v_message, user_id, v_channel, 'pending'
      from public.communication_recipients where message_id = v_message;
    end if;
  end loop;

  insert into public.communication_audit (message_id, actor_id, actor_role, action, audience_mode, recipient_count)
  values (v_message, v_uid, v_role, 'send', p_mode, v_count);

  return v_message;
end;
$$;

-- ─── 8. Member actions ───────────────────────────────────────────────────────

create or replace function public.mark_message_read(p_message_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.communication_recipients r
     set read_at = coalesce(r.read_at, now())
   where r.message_id = p_message_id
     and r.user_id = auth.uid()
     and public.is_active_member();
$$;

-- ─── 9. Function privileges (explicit, per contract §9) ──────────────────────

revoke all on function public.is_message_sender(uuid)              from public, anon;
revoke all on function public.is_message_recipient(uuid)           from public, anon;
revoke all on function public.assert_can_send_message(text, uuid[], uuid[], uuid[]) from public, anon;
revoke all on function public.preview_audience(text, uuid[], uuid[], uuid[])        from public, anon;
revoke all on function public.send_message(text, text, text, uuid[], uuid[], uuid[], text[], uuid) from public, anon;
revoke all on function public.mark_message_read(uuid)              from public, anon;

grant execute on function public.is_message_sender(uuid)              to authenticated, service_role;
grant execute on function public.is_message_recipient(uuid)           to authenticated, service_role;
grant execute on function public.assert_can_send_message(text, uuid[], uuid[], uuid[]) to authenticated, service_role;
grant execute on function public.preview_audience(text, uuid[], uuid[], uuid[])        to authenticated;
grant execute on function public.send_message(text, text, text, uuid[], uuid[], uuid[], text[], uuid) to authenticated;
grant execute on function public.mark_message_read(uuid)              to authenticated;

-- ─── 10. Delivery claiming and recovery (service role only) ──────────────────

-- Atomically moves rows to 'sending' and counts the attempt. Returns only the rows this call claimed.
-- Eligible: 'pending' rows, and 'failed' rows the provider definitively did not accept ('retryable'), capped at
-- three attempts. Retries happen only when a sender triggers dispatch again. Nothing retries automatically.
create or replace function public.claim_deliveries(p_message_id uuid, p_channel text)
returns setof public.communication_deliveries
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.communication_deliveries d
     set status = 'sending',
         attempts = d.attempts + 1,
         attempted_at = now()
   where d.message_id = p_message_id
     and d.channel = p_channel
     and (
       d.status = 'pending'
       or (d.status = 'failed' and d.retryable and d.attempts < 3)
     )
  returning d.*;
$$;

-- A row stuck in 'sending' means the dispatcher stopped before it recorded an outcome. The provider may already have
-- accepted the message, so the row is marked 'failed' with an 'outcome-unknown' reason and is NOT retryable.
-- Re-sending it could duplicate external delivery.
create or replace function public.expire_stuck_deliveries(p_older_than interval default interval '15 minutes')
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with expired as (
    update public.communication_deliveries d
       set status = 'failed',
           reason = 'outcome-unknown: dispatch stopped before the provider answered',
           retryable = false
     where d.status = 'sending'
       and d.attempted_at < now() - p_older_than
    returning 1
  )
  select count(*)::integer from expired;
$$;

revoke all on function public.claim_deliveries(uuid, text)         from public, anon, authenticated;
revoke all on function public.expire_stuck_deliveries(interval)    from public, anon, authenticated;
grant execute on function public.claim_deliveries(uuid, text)      to service_role;
grant execute on function public.expire_stuck_deliveries(interval) to service_role;
