-- 078_events_composite_audience.sql
--
-- Forward-only correction. Ported from consolidated 073 section 0.
--
-- The shared audience model (073) has a composite mode: any union of cells, groups and people. The events table's
-- audience check (060) still lists only the five legacy modes, so a targeted event written with a composite spec was
-- refused by the database. Events now accept the composite mode as well. Its audience_spec_id is still required for
-- every mode except 'all' and 'meeting' (060 and 068).
--
-- Dependencies: 060 (events_audience_check), 073 (composite mode on audience_specs).

alter table public.events drop constraint if exists events_audience_check;
alter table public.events add constraint events_audience_check
  check (audience in ('all', 'meeting', 'cells', 'saved_groups', 'explicit', 'composite'));
