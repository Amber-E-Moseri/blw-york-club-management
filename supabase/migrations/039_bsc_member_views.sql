-- 039_bsc_member_views.sql
--
-- Lists the active members the caller may view through their BSC or cell
-- (see can_view_member in migration 038). Coordinators and admins see every
-- assigned member; BSC leaders see their BSC; cell leaders see their cell's BSCs.
-- A SECURITY DEFINER function avoids widening the profiles policy allow-list.

create or replace function public.bsc_members_visible()
returns table (
  id        uuid,
  full_name text,
  email     text,
  bsc_id    uuid,
  bsc_name  text,
  cell_id   uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.bsc_id, b.name, b.cell_id
  from public.profiles p
  join public.bscs b on b.id = p.bsc_id
  where p.status = 'active'
    and p.id <> auth.uid()
    and public.can_view_member(p.id)
  order by b.name, p.full_name
$$;

revoke all on function public.bsc_members_visible() from public, anon;
grant execute on function public.bsc_members_visible() to authenticated;
