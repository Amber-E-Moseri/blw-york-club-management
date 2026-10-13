-- 077_bsc_leadership_release_on_deactivation.sql
--
-- Forward-only correction. Ported from consolidated 074 section 8 (not present on unified-v2).
--
-- When an active profile stops being active, any Bible Study Class it leads loses the leadership: bscs.leader_id is
-- cleared, so no stale leader remains on the row. Access was already blocked by is_bsc_leader_of(), which requires
-- is_active_member(); this makes the stored assignment agree with that. Each release is recorded in
-- leadership_release_audit. Cell leadership is released by 072 (profiles_release_cell_leadership).
--
-- Dependencies: 040 (bscs), 049 (bscs_guard_leader_assignment), 072 (cell release, same pattern).

-- ─── 8. Deactivation: a Bible Study Class leader who stops being active loses the class leadership ───────────────────
-- bscs.leader_id is cleared, as cells.leader_id is, so no stale leader remains on the row. Access was already
-- blocked by is_bsc_leader_of(), which requires is_active_member(). Each release is recorded in leadership_release_audit.

create table if not exists public.leadership_release_audit (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null,
  target_type  text not null check (target_type in ('bsc')),
  target_id    uuid not null,
  actor_id     uuid,
  released_at  timestamptz not null default now()
);

create index if not exists leadership_release_audit_profile_idx on public.leadership_release_audit (profile_id, released_at desc);

alter table public.leadership_release_audit enable row level security;

drop policy if exists leadership_release_audit_read on public.leadership_release_audit;
create policy leadership_release_audit_read on public.leadership_release_audit
  for select using (public.is_admin_or_coordinator());

revoke all on table public.leadership_release_audit from anon, authenticated;
grant select on table public.leadership_release_audit to authenticated;
grant select, insert, update, delete on table public.leadership_release_audit to service_role;

create or replace function public.release_bsc_leadership_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if old.status = 'active' and new.status is distinct from 'active' then
    insert into public.leadership_release_audit (profile_id, target_type, target_id, actor_id)
    select new.id, 'bsc', b.id, auth.uid()
      from public.bscs b
     where b.leader_id = new.id;

    update public.bscs b
       set leader_id = null
     where b.leader_id = new.id;
  end if;
  return new;
end;
$function$;

revoke all on function public.release_bsc_leadership_on_deactivation() from public, anon, authenticated, service_role;

drop trigger if exists profiles_release_bsc_leadership on public.profiles;
create trigger profiles_release_bsc_leadership
  after update of status on public.profiles
  for each row execute function public.release_bsc_leadership_on_deactivation();
