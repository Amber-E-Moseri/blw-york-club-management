-- Read-only report: historical cell-leadership records that disagree with the canonical rule (cells.leader_id is
-- authoritative). Nothing is changed. Run in the Supabase SQL editor against the target project; review each row before
-- any correction. Roles and leadership assignments are never rewritten automatically.
--
-- Section A: accounts with the cell_leader role that lead no cell (role confers no cell authority).
-- Section B: cells whose recorded leader is not an active member, or whose leader has the ordinary member role
--            (still authoritative; the role mismatch is informational).
-- Section C: cells whose recorded leader is a pending or rejected applicant (must not hold leadership).
-- Section D: members who lead a cell but belong to a different cell than the one they lead.

-- A
select p.id, p.full_name, p.status, p.cell_id
from public.profiles p
where p.role = 'cell_leader'
  and not exists (select 1 from public.cells c where c.leader_id = p.id)
order by p.full_name;

-- B
select c.id as cell_id, c.name as cell_name, p.id as leader_id, p.role, p.status
from public.cells c
join public.profiles p on p.id = c.leader_id
where p.status <> 'active' or p.role = 'member'
order by c.name;

-- C
select c.id as cell_id, c.name as cell_name, p.id as leader_id, p.status
from public.cells c
join public.profiles p on p.id = c.leader_id
where p.status in ('pending', 'rejected')
order by c.name;

-- D
select c.id as cell_id, c.name as cell_name, p.id as leader_id, p.cell_id as leader_home_cell
from public.cells c
join public.profiles p on p.id = c.leader_id
where p.cell_id is distinct from c.id
order by c.name;
