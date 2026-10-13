-- 082_audience_security_corrections.sql
--
-- Forward-only corrections from the final release certification review of 7fae0f0 (081). Each fixes a defect the
-- review found in an audience function. Nothing here grants any client new access.
--
-- 1. preview_audience() inserted an audience_specs row on every call. Specs are immutable and cannot be deleted
--    (072), so each preview left a permanent row, and the write went around create_audience_spec(). Resolution is now
--    a function of fields: audience_resolve_fields(). preview_audience() uses it and writes nothing.
--    resolve_audience_all(spec) keeps its meaning: it resolves the stored spec's fields through the same function.
--    audience_resolve_fields() is internal (owner-only). Callers reach it only through the definer functions above.
--
-- 2. meeting_audience_spec(meeting) returned the audience spec of any meeting to any signed-in account, with no check.
--    It is called from meeting_attendance_normalise(), a SECURITY INVOKER trigger that runs as the signed-in user, so
--    its EXECUTE grant must stay. The fix is the body: only a meeting manager receives the spec. Anyone else is refused.
--
-- 3. audience_specs_block_change() and block_targeted_audience_change() are trigger functions. A trigger function
--    cannot be called directly, but they carried EXECUTE for PUBLIC, anon, authenticated and service_role. The grants
--    are removed, so only the trigger mechanism uses them.
--
-- Dependencies: 059 and 073 (audience_specs and its columns), 072 (immutability), 075 (preview contract), 076
-- (create_saved_group), 077 to 081 (unchanged).

-- ─── 1. Field-based resolution (internal) ────────────────────────────────────────────────────────────────────────────

create or replace function public.audience_resolve_fields(
  p_mode                 text,
  p_cell_ids             uuid[] default null,
  p_group_ids            uuid[] default null,
  p_profile_ids          uuid[] default null,
  p_excluded_cell_ids    uuid[] default null,
  p_excluded_group_ids   uuid[] default null,
  p_excluded_profile_ids uuid[] default null
)
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with included as (
    select p.id
    from public.profiles p
    where p.status = 'active'
      and (
        p_mode = 'all'
        or (p_mode in ('cells', 'composite') and p.cell_id = any(p_cell_ids))
        or (p_mode in ('explicit', 'composite') and p.id = any(p_profile_ids))
        or (p_mode in ('saved_groups', 'composite') and exists (
              select 1
              from public.saved_group_members sgm
              join public.saved_groups sg on sg.id = sgm.group_id
              where sgm.profile_id = p.id
                and sgm.group_id = any(p_group_ids)
                and sg.is_active = true
            ))
      )
  ),
  excluded as (
    select p.id
    from public.profiles p
    where p.cell_id = any(p_excluded_cell_ids)
       or p.id = any(p_excluded_profile_ids)
       or exists (
            select 1
            from public.saved_group_members sgm
            where sgm.profile_id = p.id
              and sgm.group_id = any(p_excluded_group_ids)
          )
  )
  select distinct i.id
  from included i
  where not exists (select 1 from excluded e where e.id = i.id)
  order by i.id;
$function$;

revoke all on function public.audience_resolve_fields(text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[])
  from public, anon, authenticated, service_role;

-- ─── 1b. Stored specs resolve through the same function (same result, no duplicated rule) ────────────────────────────

create or replace function public.resolve_audience_all(p_spec_id uuid)
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select r.profile_id
  from public.audience_specs s
  cross join lateral public.audience_resolve_fields(
    s.mode, s.cell_ids, s.group_ids, s.profile_ids,
    s.excluded_cell_ids, s.excluded_group_ids, s.excluded_profile_ids
  ) r
  where s.id = p_spec_id;
$function$;

-- ─── 1c. Preview: computed, never stored ───────────────────────────────────────────────────────────────────────────

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
as $function$
declare
  v_result jsonb;
begin
  perform public.assert_can_send_message(p_mode, p_cell_ids, p_group_ids, p_profile_ids);

  select jsonb_build_object(
    'recipients', coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'cellId', p.cell_id)
                                     order by p.full_name), '[]'::jsonb),
    'count', count(*)
  )
  into v_result
  from public.profiles p
  where p.id in (
    select r.profile_id
    from public.audience_resolve_fields(
      p_mode,
      case when p_mode = 'cells' then p_cell_ids end,
      case when p_mode = 'saved_groups' then p_group_ids end,
      case when p_mode = 'explicit' then p_profile_ids end,
      null, null, null
    ) r
  );

  return v_result;
end;
$function$;

-- ─── 2. Gate the spec lookup on meeting management ──────────────────────────────────────────────────────────────────

create or replace function public.meeting_audience_spec(p_meeting_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_spec uuid;
begin
  if not public.is_meeting_manager(p_meeting_id) then
    raise exception 'Not authorised to read this meeting audience.' using errcode = '42501';
  end if;
  select m.audience_spec_id into v_spec from public.meetings m where m.id = p_meeting_id;
  return v_spec;
end;
$function$;

revoke all on function public.meeting_audience_spec(uuid) from public, anon;
grant execute on function public.meeting_audience_spec(uuid) to authenticated;


-- ─── 3. Trigger functions are not executable by any API role ───────────────────────────────────────────────────────

revoke all on function public.audience_specs_block_change() from public, anon, authenticated, service_role;
revoke all on function public.block_targeted_audience_change() from public, anon, authenticated, service_role;
