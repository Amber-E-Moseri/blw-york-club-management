-- N1 historical link audit (design section 3.4). READ-ONLY. Run by staff against production through the SQL editor
-- with a reviewer's account. It changes nothing. Migration 099 does not rewrite these links; staff decide each one.
--
-- A row is a link that the pre-099 signup trigger may have made by email matching alone. Columns:
--   profile_id, profile_status      the account
--   email_confirmed                 whether auth.users.email_confirmed_at was set when the audit ran
--   confirmed_at_link               confirmation time, to compare with the account's created_at
--   person_id, person_email         the person it is linked to
--   linked_while_pending            status is still 'pending' (the N1d/N1e exposure window)
--
-- Priority for review: linked_while_pending = true AND email_confirmed = false, then pending accounts in general.
-- Active members linked by staff (status active) are kept as they are.

select
  p.id                                   as profile_id,
  p.status                               as profile_status,
  (u.email_confirmed_at is not null)     as email_confirmed,
  u.email_confirmed_at                   as confirmed_at_link,
  p.person_id,
  pe.email                               as person_email,
  (p.status = 'pending')                 as linked_while_pending,
  p.joined_at                            as profile_joined_at
from public.profiles p
join public.people pe on pe.id = p.person_id
left join auth.users u on u.id = p.id
where p.person_id is not null
  and public.normalize_identity_email(u.email) = public.normalize_identity_email(pe.email)
order by linked_while_pending desc, email_confirmed asc, p.joined_at;
