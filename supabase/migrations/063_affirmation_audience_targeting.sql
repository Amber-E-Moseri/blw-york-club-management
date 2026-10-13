-- 063_affirmation_audience_targeting.sql
--
-- Owner workstream: Individual Assignments / Affirmations
-- Dependencies:    Migration 059 (audience_specs, resolve_audience)
--                  Migration 017 (confessions), 032 (active guard), 052 (declaration privacy)
-- Contract ref:    docs/ops-shared-contracts.md §7
--
-- Adds optional audience targeting to confessions (display name: Affirmations).
--
-- Backward compat: audience_spec_id NULL → legacy broadcast (all active members, as before).
-- When audience_spec_id IS NOT NULL: only members returned by resolve_audience(audience_spec_id)
-- may see and declare the affirmation.
--
-- Declaration INSERT guard: a member may declare an affirmation only if they can SELECT it,
-- which is enforced by the updated confessions_read policy (RLS on confession_declarations
-- checks against the parent confession via can_declare_affirmation() helper).

-- ─── 1. Add audience_spec_id to confessions ──────────────────────────────────

alter table public.confessions
  add column if not exists audience_spec_id uuid references public.audience_specs(id) on delete set null;

-- ─── 2. Helper: can the calling user see this affirmation? ───────────────────

create or replace function public.can_see_affirmation(p_confession_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.confessions c
    where c.id = p_confession_id
      and c.is_active = true
      and (
        -- Broadcast: no audience spec — all active members
        c.audience_spec_id is null
        -- Targeted: caller must be in the resolved audience
        or exists (
          select 1
          from public.resolve_audience(c.audience_spec_id) ra
          where ra.profile_id = auth.uid()
        )
        -- Staff always see targeted affirmations (for review/management)
        or public.is_admin_or_coordinator()
      )
  )
$$;

revoke all on function public.can_see_affirmation(uuid) from public, anon;
grant execute on function public.can_see_affirmation(uuid) to authenticated, service_role;

-- ─── 3. Replace confessions_read policy ──────────────────────────────────────

drop policy if exists confessions_read on public.confessions;
create policy confessions_read on public.confessions
  for select
  using (
    is_active = true
    and public.is_active_member()
    and (
      audience_spec_id is null
      or public.is_admin_or_coordinator()
      or exists (
        select 1
        from public.resolve_audience(audience_spec_id) ra
        where ra.profile_id = auth.uid()
      )
    )
  );

-- ─── 4. Tighten confession_declarations_write_own: audience guard ─────────────
--
-- A member may only declare an affirmation they can see.
-- The existing write policy only checks auth.uid() = user_id and is_active_member().
-- We add a check that the calling user can see the affirmation.

drop policy if exists confession_declarations_write_own on public.confession_declarations;
create policy confession_declarations_write_own on public.confession_declarations
  for insert
  with check (
    auth.uid() = user_id
    and public.is_active_member()
    and public.can_see_affirmation(confession_id)
  );
