-- 040_bsc_grants.sql
--
-- Migration 038 created fellowships and bscs without GRANTs. This project grants table access
-- explicitly (see migrations 020 and 024), so without these grants every BSC query fails with
-- "permission denied". Row-level security still decides which rows each user can see or change.

grant select, insert, update, delete on table public.fellowships, public.bscs to authenticated;
grant select, insert, update, delete on table public.fellowships, public.bscs to service_role;
