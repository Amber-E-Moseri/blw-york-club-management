# Hosted catalog gap against the b458a5c candidate (073)

Source: the evidence package blwyork-release-evidence-transfer.zip (catalog exports, previously collected; not fresh reads).
Method: object names only, from scripts/hosted-upgrade-plan.mjs --catalog. A ledger is not in the package, so recorded-migration status is unknown.

## Preview (yziuhtxtznginhdpqurb)
```
[preview] no ledger supplied: recorded-migration status is unknown, object gap only
[preview] catalog server 17.11
[preview] tables: missing 13, extra 19
[preview]   missing table announcement_dispatches -> 069_announcement_dispatch_scope.sql
[preview]   missing table web_audit_log -> 047_website_authorization.sql
[preview]   missing table web_client_rate_limits -> 052_web_edge_support.sql
[preview]   missing table web_content -> 048_web_content.sql
[preview]   missing table web_download_events -> 051_web_rhapsody.sql
[preview]   missing table web_event_publications -> 049_web_blog_events.sql
[preview]   missing table web_inbound_submissions -> 050_web_inquiries_media.sql
[preview]   missing table web_media -> 050_web_inquiries_media.sql
[preview]   missing table web_permission_catalogue -> 047_website_authorization.sql
[preview]   missing table web_posts -> 049_web_blog_events.sql
[preview]   missing table web_rate_limits -> 050_web_inquiries_media.sql
[preview]   missing table web_rhapsody_editions -> 051_web_rhapsody.sql
[preview]   missing table web_versions -> 048_web_content.sql
[preview] views: missing 11, extra 0
[preview]   missing view contacts_bsc_view -> 042_bsc_contact_visibility.sql
[preview]   missing view membership_reconciliation_review -> 045_account_membership_profile_reconciliation.sql
[preview]   missing view organizational_member_directory -> 045_account_membership_profile_reconciliation.sql
[preview]   missing view v_announcement_dispatch_attention -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[preview]   missing view v_cell_member_directory -> 070_cell_leader_disclosure_closure.sql
[preview]   missing view v_meeting_attendance_classification -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[preview]   missing view v_prayer_requests_visible -> 070_cell_leader_disclosure_closure.sql
[preview]   missing view v_public_content -> 048_web_content.sql
[preview]   missing view v_public_editions -> 051_web_rhapsody.sql
[preview]   missing view v_public_events -> 049_web_blog_events.sql
[preview]   missing view v_public_posts -> 049_web_blog_events.sql
[preview] functions: missing 77, extra 83
[preview]   missing function _mirror_profile_to_user_profiles -> 062_profile_field_sync.sql
[preview]   missing function _mirror_user_profile_to_profiles -> 062_profile_field_sync.sql
[preview]   missing function _resolve_contact_assignee -> 072_leader_reassignment_and_follow_up_guard.sql
[preview]   missing function _web_audit -> 047_website_authorization.sql
[preview]   missing function _web_check_event_publication -> 049_web_blog_events.sql
[preview]   missing function _web_edit_permission -> 048_web_content.sql
[preview]   missing function _web_ensure_content -> 048_web_content.sql
[preview]   missing function _web_guard_last_website_permission -> 059_web_role_non_empty_permissions.sql
[preview]   missing function _web_guard_website_rbac -> 047_website_authorization.sql
[preview]   missing function _web_publish_permission -> 048_web_content.sql
[preview]   missing function _web_refuse_audit_mutation -> 047_website_authorization.sql
[preview]   missing function _web_require -> 047_website_authorization.sql
[preview]   missing function _web_require_core_admin -> 047_website_authorization.sql
[preview]   missing function _web_validate_content -> 048_web_content.sql
[preview]   missing function announcement_dispatch_authorised -> 069_announcement_dispatch_scope.sql
[preview]   missing function assign_contact_follow_up -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[preview]   missing function assignments_guard_assignee_update -> 064_assignments.sql
[preview]   missing function begin_announcement_send -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[preview]   missing function claim_announcement_dispatch -> 069_announcement_dispatch_scope.sql
[preview]   missing function complete_announcement_dispatch -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[preview]   missing function contact_follow_ups_guard_assignee -> 072_leader_reassignment_and_follow_up_guard.sql
[preview]   missing function contacts_guard_follow_up_assignee -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[preview]   missing function contacts_resolve_person -> 073_contact_person_linking_server_side.sql
[preview]   missing function get_cell_member_profile -> 070_cell_leader_disclosure_closure.sql
[preview]   missing function get_cell_member_read_dates -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[preview]   missing function get_cell_ror_progress -> 039_ror_reading_streaks.sql
[preview]   missing function get_org_ror_progress -> 039_ror_reading_streaks.sql
[preview]   missing function get_ror_streak -> 039_ror_reading_streaks.sql
[preview]   missing function is_bsc_leader_for_logger -> 042_bsc_contact_visibility.sql
[preview]   missing function is_bsc_peer_of_logger -> 042_bsc_contact_visibility.sql
[preview]   missing function is_cell_leader_of_user -> 064_assignments.sql
[preview]   missing function is_member_in_my_cell -> 039_ror_reading_streaks.sql
[preview]   missing function list_cell_leaders -> 072_leader_reassignment_and_follow_up_guard.sql
[preview]   missing function member_roster_key -> 070_cell_leader_disclosure_closure.sql
[preview]   missing function reassign_contact_follow_up -> 072_leader_reassignment_and_follow_up_guard.sql
[preview]   missing function release_announcement_dispatch -> 069_announcement_dispatch_scope.sql
[preview]   missing function resolve_announcement_recipients -> 069_announcement_dispatch_scope.sql
[preview]   missing function resolve_cell_member_user -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[preview]   missing function web_assign_website_role -> 047_website_authorization.sql
[preview]   missing function web_authorize_edition -> 051_web_rhapsody.sql
[preview]   missing function web_consume_client_limit -> 052_web_edge_support.sql
[preview]   missing function web_create_website_role -> 047_website_authorization.sql
[preview]   missing function web_download_stats -> 051_web_rhapsody.sql
[preview]   missing function web_get_content -> 048_web_content.sql
[preview]   missing function web_has_permission -> 047_website_authorization.sql
[preview]   missing function web_is_core_admin -> 047_website_authorization.sql
[preview]   missing function web_list_editions -> 051_web_rhapsody.sql
[preview]   missing function web_list_event_publications -> 049_web_blog_events.sql
[preview]   missing function web_list_inquiries -> 050_web_inquiries_media.sql
[preview]   missing function web_list_media -> 050_web_inquiries_media.sql
[preview]   missing function web_list_posts -> 049_web_blog_events.sql
[preview]   missing function web_list_versions -> 048_web_content.sql
[preview]   missing function web_list_website_assignments -> 047_website_authorization.sql
[preview]   missing function web_list_website_roles -> 047_website_authorization.sql
[preview]   missing function web_media_upload_allowed -> 052_web_edge_support.sql
[preview]   missing function web_my_permissions -> 047_website_authorization.sql
[preview]   missing function web_orphaned_uploads -> 053_web_media_verification.sql
[preview]   missing function web_publish_content -> 048_web_content.sql
[preview]   missing function web_purge_expired_inquiries -> 050_web_inquiries_media.sql
[preview]   missing function web_record_download -> 051_web_rhapsody.sql
[preview]   missing function web_register_media -> 050_web_inquiries_media.sql
[preview]   missing function web_resolve_edition_pdf -> 052_web_edge_support.sql
[preview]   missing function web_retire_website_role -> 057_web_retire_role.sql
[preview]   missing function web_rollback_content -> 048_web_content.sql
[preview]   missing function web_save_draft -> 048_web_content.sql
[preview]   missing function web_save_edition -> 051_web_rhapsody.sql
[preview]   missing function web_save_post -> 049_web_blog_events.sql
[preview]   missing function web_set_edition_status -> 051_web_rhapsody.sql
[preview]   missing function web_set_event_publication -> 049_web_blog_events.sql
[preview]   missing function web_set_inquiry_status -> 050_web_inquiries_media.sql
[preview]   missing function web_set_post_status -> 049_web_blog_events.sql
[preview]   missing function web_set_website_permission -> 047_website_authorization.sql
[preview]   missing function web_set_website_role_permissions -> 058_web_role_atomic_permissions.sql
[preview]   missing function web_submit_inquiry -> 050_web_inquiries_media.sql
[preview]   missing function web_unassign_website_role -> 047_website_authorization.sql
[preview]   missing function web_unpublish_content -> 056_web_unpublish_content.sql
[preview]   missing function web_upload_still_unreferenced -> 054_web_cleanup_revalidation.sql
[preview]   extra tables (not in candidate chain): audience_publications, audience_snapshots, bsc_assignment_audit, cell_admin_audit, communication_audit, communication_deliveries, communication_messages, communication_recipients, contact_attribution_audit, fellowships, identity_claims, identity_read_audit, identity_review_audit, leadership_release_audit, member_cell_audit, member_status_audit, person_identity_audit, profile_approval_audit, profile_link_audit
[preview]   extra functions (not in candidate chain): _auth_has_pending_email_change, _f2_active_actor, _f2_caller_person_id, _f2_check_follow_up_assignee, _f2_guard_contact_logger, _f2_guard_contact_person, _f2_keys_for, _f2_lock_keys, _f2_refuse_audit_mutation, _f2_staff_actor, _f2_submit_contact_row, _f2_valid_reason, assert_can_send_message, assign_member_to_bsc, assign_pending_applicant_to_cell, assignments_guard_assignee_changes, audience_caller_can_target, audience_content_recipients, audience_resolve_fields, audience_snapshot_content, audience_specs_block_change, audit_cell_admin_change, audit_member_cell_change, begin_cell_change, block_targeted_audience_change, bsc_members_visible, can_see_affirmation, can_view_meeting, can_view_member, cell_leader_pending_roster, claim_deliveries, communication_audit_block_change, confession_declaration_counts, correct_contact_attribution, create_assignments, create_audience_spec, create_saved_group, create_targeted_affirmation, establish_membership, expire_stuck_deliveries, get_claim_identity, get_person_identity, guard_bsc_delete_empty, guard_bsc_leader_eligibility, guard_cell_lifecycle, guard_leader_assignment, guard_member_cell_placement, is_audience_recipient, is_callers_person, is_meeting_creator, is_meeting_invitee, is_meeting_manager, is_meeting_participant, is_message_recipient, is_message_sender, link_pending_profile_to_person, list_account_link_queue, list_identity_claims, mark_message_read, meeting_attendance_guard_delete, meeting_audience_spec, meeting_roster_allowed, person_has_unapproved_profile, preview_audience, profile_is_pending, publish_meeting, release_bsc_leadership_on_deactivation, release_cell_leadership_on_deactivation, resolve_audience_all, resolve_identity_claim, saved_group_members_require_active, send_message, set_meeting_audience, set_meeting_audience_apply, set_member_status, snapshot_affirmation_audience, snapshot_announcement_audience, snapshot_event_audience, submit_contact, submit_contacts_batch, transfer_member_cell, transition_membership, update_person_identity
```

## Production (rjtstjmtddqhesexltbj)
```
[production] no ledger supplied: recorded-migration status is unknown, object gap only
[production] catalog server 17.11
[production] tables: missing 17, extra 1
[production]   missing table announcement_dispatches -> 069_announcement_dispatch_scope.sql
[production]   missing table assignments -> 064_assignments.sql
[production]   missing table audience_specs -> 061_shared_audience_infrastructure.sql
[production]   missing table saved_group_members -> 061_shared_audience_infrastructure.sql
[production]   missing table saved_groups -> 061_shared_audience_infrastructure.sql
[production]   missing table web_audit_log -> 047_website_authorization.sql
[production]   missing table web_client_rate_limits -> 052_web_edge_support.sql
[production]   missing table web_content -> 048_web_content.sql
[production]   missing table web_download_events -> 051_web_rhapsody.sql
[production]   missing table web_event_publications -> 049_web_blog_events.sql
[production]   missing table web_inbound_submissions -> 050_web_inquiries_media.sql
[production]   missing table web_media -> 050_web_inquiries_media.sql
[production]   missing table web_permission_catalogue -> 047_website_authorization.sql
[production]   missing table web_posts -> 049_web_blog_events.sql
[production]   missing table web_rate_limits -> 050_web_inquiries_media.sql
[production]   missing table web_rhapsody_editions -> 051_web_rhapsody.sql
[production]   missing table web_versions -> 048_web_content.sql
[production] views: missing 10, extra 0
[production]   missing view membership_reconciliation_review -> 045_account_membership_profile_reconciliation.sql
[production]   missing view organizational_member_directory -> 045_account_membership_profile_reconciliation.sql
[production]   missing view v_announcement_dispatch_attention -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[production]   missing view v_cell_member_directory -> 070_cell_leader_disclosure_closure.sql
[production]   missing view v_meeting_attendance_classification -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[production]   missing view v_prayer_requests_visible -> 070_cell_leader_disclosure_closure.sql
[production]   missing view v_public_content -> 048_web_content.sql
[production]   missing view v_public_editions -> 051_web_rhapsody.sql
[production]   missing view v_public_events -> 049_web_blog_events.sql
[production]   missing view v_public_posts -> 049_web_blog_events.sql
[production] functions: missing 75, extra 2
[production]   missing function _mirror_profile_to_user_profiles -> 062_profile_field_sync.sql
[production]   missing function _mirror_user_profile_to_profiles -> 062_profile_field_sync.sql
[production]   missing function _resolve_contact_assignee -> 072_leader_reassignment_and_follow_up_guard.sql
[production]   missing function _web_audit -> 047_website_authorization.sql
[production]   missing function _web_check_event_publication -> 049_web_blog_events.sql
[production]   missing function _web_edit_permission -> 048_web_content.sql
[production]   missing function _web_ensure_content -> 048_web_content.sql
[production]   missing function _web_guard_last_website_permission -> 059_web_role_non_empty_permissions.sql
[production]   missing function _web_guard_website_rbac -> 047_website_authorization.sql
[production]   missing function _web_publish_permission -> 048_web_content.sql
[production]   missing function _web_refuse_audit_mutation -> 047_website_authorization.sql
[production]   missing function _web_require -> 047_website_authorization.sql
[production]   missing function _web_require_core_admin -> 047_website_authorization.sql
[production]   missing function _web_validate_content -> 048_web_content.sql
[production]   missing function announcement_dispatch_authorised -> 069_announcement_dispatch_scope.sql
[production]   missing function assign_contact_follow_up -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[production]   missing function assignments_completed_at_stamp -> 064_assignments.sql
[production]   missing function assignments_guard_assignee_update -> 064_assignments.sql
[production]   missing function begin_announcement_send -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[production]   missing function claim_announcement_dispatch -> 069_announcement_dispatch_scope.sql
[production]   missing function complete_announcement_dispatch -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[production]   missing function contact_follow_ups_guard_assignee -> 072_leader_reassignment_and_follow_up_guard.sql
[production]   missing function contacts_guard_follow_up_assignee -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[production]   missing function contacts_resolve_person -> 073_contact_person_linking_server_side.sql
[production]   missing function get_cell_member_profile -> 070_cell_leader_disclosure_closure.sql
[production]   missing function get_cell_member_read_dates -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[production]   missing function is_cell_leader_of_user -> 064_assignments.sql
[production]   missing function list_cell_leaders -> 072_leader_reassignment_and_follow_up_guard.sql
[production]   missing function meeting_attendance_normalise -> 046_attendance_status_authority.sql
[production]   missing function member_roster_key -> 070_cell_leader_disclosure_closure.sql
[production]   missing function reassign_contact_follow_up -> 072_leader_reassignment_and_follow_up_guard.sql
[production]   missing function release_announcement_dispatch -> 069_announcement_dispatch_scope.sql
[production]   missing function resolve_announcement_recipients -> 069_announcement_dispatch_scope.sql
[production]   missing function resolve_audience -> 061_shared_audience_infrastructure.sql
[production]   missing function resolve_cell_member_user -> 071_scoped_assignments_progress_and_attendance_preservation.sql
[production]   missing function respond_to_meeting_invitation -> 046_attendance_status_authority.sql
[production]   missing function web_assign_website_role -> 047_website_authorization.sql
[production]   missing function web_authorize_edition -> 051_web_rhapsody.sql
[production]   missing function web_consume_client_limit -> 052_web_edge_support.sql
[production]   missing function web_create_website_role -> 047_website_authorization.sql
[production]   missing function web_download_stats -> 051_web_rhapsody.sql
[production]   missing function web_get_content -> 048_web_content.sql
[production]   missing function web_has_permission -> 047_website_authorization.sql
[production]   missing function web_is_core_admin -> 047_website_authorization.sql
[production]   missing function web_list_editions -> 051_web_rhapsody.sql
[production]   missing function web_list_event_publications -> 049_web_blog_events.sql
[production]   missing function web_list_inquiries -> 050_web_inquiries_media.sql
[production]   missing function web_list_media -> 050_web_inquiries_media.sql
[production]   missing function web_list_posts -> 049_web_blog_events.sql
[production]   missing function web_list_versions -> 048_web_content.sql
[production]   missing function web_list_website_assignments -> 047_website_authorization.sql
[production]   missing function web_list_website_roles -> 047_website_authorization.sql
[production]   missing function web_media_upload_allowed -> 052_web_edge_support.sql
[production]   missing function web_my_permissions -> 047_website_authorization.sql
[production]   missing function web_orphaned_uploads -> 053_web_media_verification.sql
[production]   missing function web_publish_content -> 048_web_content.sql
[production]   missing function web_purge_expired_inquiries -> 050_web_inquiries_media.sql
[production]   missing function web_record_download -> 051_web_rhapsody.sql
[production]   missing function web_register_media -> 050_web_inquiries_media.sql
[production]   missing function web_resolve_edition_pdf -> 052_web_edge_support.sql
[production]   missing function web_retire_website_role -> 057_web_retire_role.sql
[production]   missing function web_rollback_content -> 048_web_content.sql
[production]   missing function web_save_draft -> 048_web_content.sql
[production]   missing function web_save_edition -> 051_web_rhapsody.sql
[production]   missing function web_save_post -> 049_web_blog_events.sql
[production]   missing function web_set_edition_status -> 051_web_rhapsody.sql
[production]   missing function web_set_event_publication -> 049_web_blog_events.sql
[production]   missing function web_set_inquiry_status -> 050_web_inquiries_media.sql
[production]   missing function web_set_post_status -> 049_web_blog_events.sql
[production]   missing function web_set_website_permission -> 047_website_authorization.sql
[production]   missing function web_set_website_role_permissions -> 058_web_role_atomic_permissions.sql
[production]   missing function web_submit_inquiry -> 050_web_inquiries_media.sql
[production]   missing function web_unassign_website_role -> 047_website_authorization.sql
[production]   missing function web_unpublish_content -> 056_web_unpublish_content.sql
[production]   missing function web_upload_still_unreferenced -> 054_web_cleanup_revalidation.sql
[production]   extra tables (not in candidate chain): fellowships
[production]   extra functions (not in candidate chain): bsc_members_visible, can_view_member
```

## Reading
- Production lacks the candidate objects from 047 (web tables and routines), 061 (audience and saved groups), 064 (assignments), 069 (announcement dispatch) and the later views. Its path is additive, and the mapping above names the candidate file for each missing object.
- Preview holds 19 tables that the candidate does not define (communication_*, identity_*, audience_snapshots, fellowships and audit tables). Preview is not an additive target. Its lineage needs an owner decision before any upgrade path is chosen.
- Ledger need: the catalog cannot say which candidate versions are recorded. One narrow read-only export per project is required: select version, name from supabase_migrations.schema_migrations order by version;
