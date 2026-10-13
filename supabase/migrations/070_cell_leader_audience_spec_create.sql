-- 069_cell_leader_audience_spec_create.sql
--
-- Owner workstream: Announcements / Targeted Messages
-- Dependencies:    059 (audience_specs_insert policy), 066 (cell leaders must supply a spec),
--                  068 (meeting RLS fix)
--
-- Problem: 059 restricted audience_specs INSERT to admin/coordinator only. 066 then tightened
--   announcements_manage so that cell leaders can only insert announcements that reference a
--   cells-mode spec for their own cell. The combination means cell leaders can never insert
--   announcements at all — there is no path for them to create the required spec.
--
-- Fix: extend audience_specs_insert to allow cell leaders to create a cells-mode spec that
--   names exactly one cell they lead. All other attributes of the original policy are preserved.
--   Cell leaders cannot create 'all', 'saved_groups' or 'explicit' specs, and they cannot
--   create a spec that names a cell they do not lead.

drop policy if exists audience_specs_insert on public.audience_specs;
create policy audience_specs_insert on public.audience_specs
  for insert
  to authenticated
  with check (
    public.is_admin_or_coordinator()
    or (
      -- Cell leaders may create a cells-mode spec targeting exactly one cell they lead.
      public.is_active_member()
      and created_by = auth.uid()
      and mode = 'cells'
      and array_length(cell_ids, 1) = 1
      and exists (
        select 1 from public.cells c
        where c.id = cell_ids[1]
          and c.leader_id = auth.uid()
      )
    )
  );
