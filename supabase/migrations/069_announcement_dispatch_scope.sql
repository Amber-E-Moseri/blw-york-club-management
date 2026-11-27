-- 069: announcement notification scope.
-- A cell announcement reaches only active members of that cell. An organization-wide announcement requires staff
-- (admin or coordinator). Authority and recipients are derived from current database state, never from a list supplied
-- by a caller. A dispatch claim makes at-most-once delivery atomic. Only the service role may execute these functions;
-- the notify-announcement edge function is the only caller.

-- ─── Dispatch claims: one row per announcement that has been dispatched or is being dispatched ──────────────────────
create table if not exists public.announcement_dispatches (
  announcement_id uuid primary key references public.announcements(id) on delete cascade,
  claimed_by      uuid references public.profiles(id) on delete set null,
  claimed_at      timestamptz not null default now()
);

alter table public.announcement_dispatches enable row level security;
revoke all on public.announcement_dispatches from public, anon, authenticated, service_role;
-- No policies. Only the security definer functions below touch this table.

-- ─── Authority: who may notify for this announcement, from live state ──────────────────────────────────────────────
-- Staff (admin or coordinator, active) may notify any announcement, including organization-wide ones.
-- An active cell leader (cells.leader_id = actor) may notify announcements scoped to a cell they lead, and only those.
-- The cell_leader role alone grants nothing.
create or replace function public.announcement_dispatch_authorised(p_announcement_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.announcements a
    join public.profiles me on me.id = p_actor
    where a.id = p_announcement_id
      and me.status = 'active'
      and (
        me.role in ('admin', 'coordinator')
        or (
          a.cell_id is not null
          and exists (
            select 1 from public.cells c
            where c.id = a.cell_id and c.leader_id = p_actor
          )
        )
      )
  );
$$;

-- ─── Claim: atomic at-most-once dispatch. Raises 42501 when the actor lacks authority. Returns false if already claimed.
create or replace function public.claim_announcement_dispatch(p_announcement_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.announcement_dispatch_authorised(p_announcement_id, p_actor) then
    raise exception 'not authorised to notify for this announcement' using errcode = '42501';
  end if;
  insert into public.announcement_dispatches (announcement_id, claimed_by)
  values (p_announcement_id, p_actor)
  on conflict (announcement_id) do nothing;
  return found;
end;
$$;

-- ─── Release: a claim may be released only by the actor who made it, and only before any push was sent. ───────────
create or replace function public.release_announcement_dispatch(p_announcement_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.announcement_dispatches
  where announcement_id = p_announcement_id and claimed_by = p_actor;
end;
$$;

-- ─── Recipients: only for an actor who holds the claim, and only the devices the scope allows. ──────────────────────
-- Cell announcement: active members whose profile is in that cell. Organization-wide: all active members.
-- Pending, rejected and inactive profiles and inactive devices are never returned.
create or replace function public.resolve_announcement_recipients(p_announcement_id uuid, p_actor uuid)
returns table (user_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.announcement_dispatches d
    where d.announcement_id = p_announcement_id and d.claimed_by = p_actor
  ) then
    raise exception 'dispatch not claimed by this actor' using errcode = '42501';
  end if;

  return query
    select p.id, s.id, s.endpoint, s.p256dh, s.auth
    from public.announcements a
    join public.profiles p
      on p.status = 'active'
     and (a.cell_id is null or p.cell_id = a.cell_id)
    join public.push_subscriptions s
      on s.user_id = p.id
     and s.is_active
    where a.id = p_announcement_id;
end;
$$;

-- ─── Privileges: service role only ────────────────────────────────────────────────────────────────────────────────
revoke all on function public.announcement_dispatch_authorised(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_announcement_dispatch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_announcement_dispatch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_announcement_recipients(uuid, uuid) from public, anon, authenticated;

grant execute on function public.claim_announcement_dispatch(uuid, uuid) to service_role;
grant execute on function public.release_announcement_dispatch(uuid, uuid) to service_role;
grant execute on function public.resolve_announcement_recipients(uuid, uuid) to service_role;
