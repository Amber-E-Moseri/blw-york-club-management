-- 045_account_membership_profile_reconciliation.sql
--
-- Keeps authentication/account approval in profiles and organizational membership in
-- people + memberships. No existing row is reclassified. Differences are exposed for
-- review instead of being merged or "fixed" automatically.

-- Trusted provisioning can still set an explicit status. Any insert that omits status
-- now fails closed into the same pending state used by handle_new_user() (019).
alter table public.profiles alter column status set default 'pending';

-- 028's trigger deliberately permits pending and active users to edit ordinary fields,
-- but its policy admitted pending users only. Make the policy match the guard. Protected
-- columns remain enforced by profiles_guard_privileged_columns.
drop policy if exists profiles_self_onboarding_update on public.profiles;
create policy profiles_self_onboarding_update on public.profiles
  for update to authenticated
  using (id = auth.uid() and status in ('pending', 'active'))
  with check (id = auth.uid() and status in ('pending', 'active'));

-- The identity/lifecycle policies introduced in 015 predated account approval. A signed-
-- in but unapproved account must not gain directory or membership-management access.
drop policy if exists people_read on public.people;
create policy people_read on public.people
  for select to authenticated
  using (
    public.is_active_member()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.person_id = people.id)
  );

drop policy if exists people_insert on public.people;
create policy people_insert on public.people
  for insert to authenticated
  with check (public.is_active_member());

drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select to authenticated
  using (
    public.is_active_member()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.person_id = memberships.person_id)
  );

drop policy if exists membership_transitions_insert on public.membership_transitions;
create policy membership_transitions_insert on public.membership_transitions
  for insert to authenticated
  with check (public.is_admin_or_coordinator());

-- Verified organizational members. A Hub account is optional; when present its approval
-- status is reported separately and never changes membership status.
create or replace view public.organizational_member_directory
with (security_invoker = true)
as
select
  pe.id as person_id,
  m.id as membership_id,
  pe.full_name,
  pe.email,
  pe.phone,
  m.joined_at,
  m.role as membership_role,
  m.status as membership_status,
  m.cell_id,
  p.id as account_id,
  p.status as account_approval_status,
  p.role as account_role,
  p.avatar_url
from public.memberships m
join public.people pe on pe.id = m.person_id
left join public.profiles p on p.person_id = pe.id
where m.status = 'active'
  and public.is_active_member();

revoke all on table public.organizational_member_directory from public, anon;
grant select on table public.organizational_member_directory to authenticated, service_role;

-- Review queue for mismatches. This is intentionally read-only and admin-scoped. It
-- preserves unlinked and conflicting records and gives operators a deterministic reason
-- to review them; it does not merge, delete, activate, or reassign anyone.
create or replace view public.membership_reconciliation_review
with (security_invoker = true)
as
with active_memberships as (
  select m.* from public.memberships m where m.status = 'active'
), linked as (
  select
    coalesce(p.person_id, m.person_id) as person_id,
    p.id as account_id,
    p.email as account_email,
    p.status as account_approval_status,
    p.role as account_role,
    p.cell_id as account_cell_id,
    m.id as membership_id,
    m.status as membership_status,
    m.role as membership_role,
    m.cell_id as membership_cell_id
  from public.profiles p
  full join active_memberships m on m.person_id = p.person_id
)
select
  l.*,
  pe.full_name,
  pe.email as person_email,
  case
    when l.person_id is null then 'account_without_person'
    when l.account_id is null then 'active_membership_without_account'
    when l.membership_id is null and l.account_approval_status = 'active' then 'approved_account_without_active_membership'
    when l.membership_id is not null and l.account_approval_status is distinct from 'active' then 'active_membership_without_approved_account'
    when l.account_role is distinct from l.membership_role then 'role_mismatch'
    when l.account_cell_id is distinct from l.membership_cell_id then 'cell_mismatch'
    else null
  end as discrepancy_code
from linked l
left join public.people pe on pe.id = l.person_id
where public.is_admin_or_coordinator()
  and (
    l.person_id is null
    or l.account_id is null
    or (l.membership_id is null and l.account_approval_status = 'active')
    or (l.membership_id is not null and l.account_approval_status is distinct from 'active')
    or l.account_role is distinct from l.membership_role
    or l.account_cell_id is distinct from l.membership_cell_id
  );

revoke all on table public.membership_reconciliation_review from public, anon;
grant select on table public.membership_reconciliation_review to authenticated, service_role;

