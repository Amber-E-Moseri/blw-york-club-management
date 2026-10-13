-- 086_audit_tables_no_service_access.sql
--
-- Forward-only release correction on the frozen 3bb8afb sequence (000–085). Ported from the older lineage's
-- 083_audit_tables_no_service_access.sql (b55aaca), renumbered because 083–085 are already taken on this lineage.
--
-- Forward-only. Audit rows must not be editable by any API key.
--
-- Four audit tables added by the candidate (cell_admin_audit, member_cell_audit, member_status_audit,
-- leadership_release_audit) granted service_role full SELECT, INSERT, UPDATE and DELETE (072, 077, 080). Their only
-- writers are SECURITY DEFINER triggers and RPCs, which run as the owner and do not need that grant. The reviewed
-- contract already denies service_role on the earlier audit tables (admin_bootstrap_audit). These four now match.
-- Nothing stops being written: the owner-run triggers and RPCs keep working.
--
-- Dependencies: 072 (cell_admin_audit, member_cell_audit), 077 (leadership_release_audit), 080 (member_status_audit).

revoke all on table public.cell_admin_audit         from service_role;
revoke all on table public.member_cell_audit        from service_role;
revoke all on table public.member_status_audit      from service_role;
revoke all on table public.leadership_release_audit from service_role;
