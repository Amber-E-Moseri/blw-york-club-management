-- 068_cell_member_contacts.sql
-- Field-level contact access for cell leaders. Forward-only. Owner decision: an active assigned cell leader may access the
-- necessary contact information (phone and email) of active members in their own cell. Nothing else is added.
--
-- Mechanism: a view with an explicit column list and an explicit row filter. The view runs as its owner, so it does not
-- depend on row policies for profiles, and the row filter is the authority: an active caller who leads the member's cell
-- (is_cell_leader_of, which also requires an active caller), and an active member. It returns no administrative fields
-- (role, admin_role, status detail, person_id, bsc_id, student_number, avatar, bio). Anonymous and cross-cell callers
-- receive no rows. Staff and existing profile visibility are unchanged; this view adds no authority.
--
-- Not changed (reported): profiles_select_scoped still lets a cell leader read the full profiles row of their cell's members
-- through the table. The application must read contacts from this view. Narrowing the table policy is the next step, and
-- depends on the directory increment.

create or replace view public.v_cell_member_contacts with (security_barrier = true) as
  select p.id as member_id,
         p.full_name,
         p.cell_id,
         p.email,
         up.phone
  from public.profiles p
  left join public.user_profiles up on up.user_id = p.id
  where p.status = 'active'
    and public.is_cell_leader_of(p.cell_id);

revoke all on public.v_cell_member_contacts from public, anon;
grant select on public.v_cell_member_contacts to authenticated;
