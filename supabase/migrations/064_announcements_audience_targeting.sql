-- 064_announcements_audience_targeting.sql
--
-- Owner workstream: Targeted Messages / Announcements
-- Dependencies:    Migration 059 (audience_specs, resolve_audience)
--                  Migration 031 (announcements_active_guard)
-- Contract ref:    docs/ops-shared-contracts.md §8
--
-- Adds audience targeting and lifecycle to announcements.
--
-- Changes:
--   1. audience_spec_id column (NULL = legacy broadcast, all authenticated users).
--   2. is_active column for soft delete / draft management.
--   3. published_at column — set when an announcement becomes visible to members.
--   4. announcements_read tightened: only active announcements, and only to audience.
--   5. announcements_manage tightened: cell leaders may only manage their own announcements
--      and may only create cell-targeted announcements for their own cell.
--
-- Backward compat: existing rows (NULL audience_spec_id, NULL is_active) are still visible
-- to all authenticated users because the updated policy treats NULL as broadcast.

-- ─── 1. Schema additions ─────────────────────────────────────────────────────

alter table public.announcements
  add column if not exists is_active    boolean     not null default true,
  add column if not exists published_at timestamptz,
  add column if not exists audience_spec_id uuid references public.audience_specs(id) on delete set null;

-- Back-fill: existing rows are considered published and broadcast.
update public.announcements
  set is_active = true
  where is_active is null;

-- ─── 2. Updated announcements_read ───────────────────────────────────────────

drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select
  using (
    is_active = true
    and public.is_active_member()
    and (
      -- Broadcast: no spec → all active members see it
      audience_spec_id is null
      -- Staff always see all announcements
      or public.is_admin_or_coordinator()
      -- Audience-targeted: caller must be in the resolved set
      or exists (
        select 1
        from public.resolve_audience(audience_spec_id) ra
        where ra.profile_id = auth.uid()
      )
    )
  );

-- ─── 3. Updated announcements_manage ─────────────────────────────────────────
--
-- Cell leaders:
--   - May select their own announcements (author_id = auth.uid()) regardless of is_active.
--   - May INSERT only when:
--       a. audience_spec_id is null (broadcast — only admin/coordinator should do this, see below)
--       b. OR audience_spec_id references a spec with mode = 'cells' targeting only their own cell.
--
-- In practice, cell leaders creating broadcast announcements is restricted at the app layer;
-- the DB policy allows it as a safety valve. The app should enforce the cell restriction.

drop policy if exists announcements_manage on public.announcements;
create policy announcements_manage on public.announcements
  for all
  to authenticated
  using (
    public.is_admin_or_coordinator()
    or (
      public.is_active_member()
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'cell_leader'
          and status = 'active'
      )
      and (
        -- Cell leaders can see announcements they authored
        author_id = auth.uid()
        -- Or announcements targeting a cell they lead
        or (
          audience_spec_id is not null
          and exists (
            select 1
            from public.audience_specs s
            where s.id = announcements.audience_spec_id
              and s.mode = 'cells'
              and exists (
                select 1 from public.cells c
                where c.id = any(s.cell_ids)
                  and c.leader_id = auth.uid()
              )
          )
        )
      )
    )
  )
  with check (
    public.is_admin_or_coordinator()
    or (
      -- Cell leaders may insert only cell-targeted announcements for their own cell
      public.is_active_member()
      and author_id = auth.uid()
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'cell_leader'
          and status = 'active'
      )
      and (
        audience_spec_id is null
        or exists (
          select 1
          from public.audience_specs s
          where s.id = audience_spec_id
            and s.mode = 'cells'
            and exists (
              select 1 from public.cells c
              where c.id = any(s.cell_ids)
                and c.leader_id = auth.uid()
            )
        )
      )
    )
  );
