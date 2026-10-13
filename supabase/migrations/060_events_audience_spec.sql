-- 060_events_audience_spec.sql
--
-- Owner workstream: Shared Audience Infrastructure
-- Dependencies:    Migration 059 (audience_specs, saved_groups)
-- Contract ref:    docs/ops-shared-contracts.md §1–2, §4
--
-- Extends events.audience to support the full audience mode set from 059.
-- The existing 'all' and 'meeting' modes are preserved for backward compatibility.
-- New modes 'cells', 'saved_groups', 'explicit' are now valid on events.
--
-- The events.audience_spec_id column links to audience_specs for new modes.
-- 'all' events continue to work without an audience_spec_id.
-- 'meeting' events continue to use audience_meeting_id (unchanged from 038/039).
-- New mode events must set audience_spec_id.

-- ─── 1. Extend the audience check constraint ──────────────────────────────────

alter table public.events
  drop constraint if exists events_audience_check;

alter table public.events
  add constraint events_audience_check
    check (audience in ('all', 'meeting', 'cells', 'saved_groups', 'explicit'));

-- ─── 2. Add audience_spec_id FK ──────────────────────────────────────────────

alter table public.events
  add column if not exists audience_spec_id uuid references public.audience_specs(id) on delete set null;

-- ─── 3. Consistency constraints ──────────────────────────────────────────────

alter table public.events
  drop constraint if exists events_new_audience_requires_spec;

alter table public.events
  add constraint events_new_audience_requires_spec
    check (
      audience in ('all', 'meeting')
      or audience_spec_id is not null
    );

-- The existing 'meeting' constraint (events_meeting_audience_requires_meeting from migration 039)
-- was already relaxed. We leave it as-is because audience_meeting_id may be null for orphaned
-- 'meeting' events (039 intentionally allows this so deleting the meeting doesn't break the event).
