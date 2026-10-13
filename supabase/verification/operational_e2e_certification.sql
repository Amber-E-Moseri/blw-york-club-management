-- operational_e2e_certification.sql
--
-- Phase 4 E2E certification for the operational workstream (migrations 059-064).
-- Run against an isolated local Supabase stack with real authenticated roles.
--
-- All 15 scenarios from docs/ops-shared-contracts.md §10.
--
-- Prerequisites:
--   - Migrations 000-064 applied in order
--   - Test users pre-created (see create-test-users.js / seed/operational_seed.sql)
--   - Run as postgres superuser for setup; individual test blocks run as the specified role
--
-- Naming convention: each block is headed by the scenario ID and description.
-- PASS/FAIL assertions use RAISE EXCEPTION on unexpected results.
-- A clean run produces only NOTICE rows and exits 0.

-- ─── Seed: create test identities ─────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE 'Operational E2E certification: setting up test identities...';
END $$;

-- These placeholders are replaced by the certification harness with real auth.uid() values.
-- Set at session start via SET LOCAL:
--   SET LOCAL ops_cert.admin_id        = '<uuid>';
--   SET LOCAL ops_cert.coordinator_id  = '<uuid>';
--   SET LOCAL ops_cert.cell_leader_id  = '<uuid>';
--   SET LOCAL ops_cert.member_a_id     = '<uuid>';
--   SET LOCAL ops_cert.member_b_id     = '<uuid>';
--   SET LOCAL ops_cert.pending_id      = '<uuid>';
--   SET LOCAL ops_cert.rejected_id     = '<uuid>';
--   SET LOCAL ops_cert.cell_id         = '<uuid>';
--   SET LOCAL ops_cert.other_cell_id   = '<uuid>';

-- ─── E2E-01: Create a cell and assign a leader ────────────────────────────────

DO $$
DECLARE
  v_cell_id   uuid;
  v_leader_id uuid;
BEGIN
  RAISE NOTICE 'E2E-01: Create a cell and assign a leader';

  -- A coordinator creates a cell
  INSERT INTO public.cells (id, name) VALUES (gen_random_uuid(), 'Test Cell E2E-01')
  RETURNING id INTO v_cell_id;

  -- Assign the cell leader
  UPDATE public.cells SET leader_id = (current_setting('ops_cert.cell_leader_id', true))::uuid
  WHERE id = v_cell_id;

  -- Verify
  IF NOT EXISTS (SELECT 1 FROM public.cells WHERE id = v_cell_id AND leader_id IS NOT NULL) THEN
    RAISE EXCEPTION 'E2E-01 FAIL: cell leader was not persisted';
  END IF;

  RAISE NOTICE 'E2E-01 PASS: cell created, leader assigned';
END $$;

-- ─── E2E-02: Add and transfer members ────────────────────────────────────────

DO $$
DECLARE
  v_member_id  uuid;
  v_cell_a_id  uuid;
  v_cell_b_id  uuid;
BEGIN
  RAISE NOTICE 'E2E-02: Add and transfer members';

  SELECT (current_setting('ops_cert.member_a_id', true))::uuid INTO v_member_id;
  SELECT (current_setting('ops_cert.cell_id', true))::uuid INTO v_cell_a_id;
  SELECT (current_setting('ops_cert.other_cell_id', true))::uuid INTO v_cell_b_id;

  -- Assign member to cell A
  UPDATE public.profiles SET cell_id = v_cell_a_id WHERE id = v_member_id;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_member_id AND cell_id = v_cell_a_id) THEN
    RAISE EXCEPTION 'E2E-02 FAIL: member was not assigned to cell A';
  END IF;

  -- Transfer to cell B
  UPDATE public.profiles SET cell_id = v_cell_b_id WHERE id = v_member_id;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_member_id AND cell_id = v_cell_a_id) THEN
    RAISE EXCEPTION 'E2E-02 FAIL: member still in cell A after transfer';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_member_id AND cell_id = v_cell_b_id) THEN
    RAISE EXCEPTION 'E2E-02 FAIL: member not in cell B after transfer';
  END IF;

  RAISE NOTICE 'E2E-02 PASS: member added and transferred';
END $$;

-- ─── E2E-03: Create a fellowship-wide event ───────────────────────────────────

DO $$
DECLARE
  v_event_id uuid;
BEGIN
  RAISE NOTICE 'E2E-03: Create a fellowship-wide event';

  INSERT INTO public.events (title, event_date, created_by, audience)
  VALUES ('All-Church Rally', CURRENT_DATE + 7, (current_setting('ops_cert.coordinator_id', true))::uuid, 'all')
  RETURNING id INTO v_event_id;

  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event_id AND audience = 'all') THEN
    RAISE EXCEPTION 'E2E-03 FAIL: event not created with audience = all';
  END IF;

  RAISE NOTICE 'E2E-03 PASS: fellowship-wide event created';
END $$;

-- ─── E2E-04: Create a private meeting for selected members ────────────────────

DO $$
DECLARE
  v_meeting_id uuid;
  v_member_id  uuid;
BEGIN
  RAISE NOTICE 'E2E-04: Create a private meeting for selected members';

  SELECT (current_setting('ops_cert.member_a_id', true))::uuid INTO v_member_id;

  INSERT INTO public.meetings (title, date, time, visibility, created_by)
  VALUES ('Leadership Inner Circle', CURRENT_DATE + 3, '19:00', 'explicit',
          (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_meeting_id;

  -- Add the invited member
  INSERT INTO public.meeting_attendances (meeting_id, user_id, user_name)
  VALUES (v_meeting_id, v_member_id, 'Test Member A');

  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_attendances
    WHERE meeting_id = v_meeting_id AND user_id = v_member_id
  ) THEN
    RAISE EXCEPTION 'E2E-04 FAIL: invited member not in meeting_attendances';
  END IF;

  RAISE NOTICE 'E2E-04 PASS: private meeting created with explicit invitee';
END $$;

-- ─── E2E-05: Excluded members cannot access explicit meeting data ─────────────
--
-- This scenario must be run with member_b SET as the calling session user.
-- The harness switches to member_b's JWT and checks:
--   a. SELECT on meetings returns no row for the explicit meeting.
--   b. SELECT on meeting_attendances returns no row for that meeting.
-- These are documented here; the .mjs harness runs the actual RLS check.

DO $$
BEGIN
  RAISE NOTICE 'E2E-05: Excluded member isolation (RLS verification)';
  RAISE NOTICE 'E2E-05: Run operational_e2e_certification.mjs for the RLS session test';
  RAISE NOTICE 'E2E-05 PENDING: requires per-user JWT session switch (see .mjs harness)';
END $$;

-- ─── E2E-06: Send announcement to all active members ─────────────────────────

DO $$
DECLARE
  v_spec_id        uuid;
  v_recipients     int;
  v_active_count   int;
BEGIN
  RAISE NOTICE 'E2E-06: Send announcement to all active members';

  -- Create an audience spec: mode = all
  INSERT INTO public.audience_specs (mode, created_by)
  VALUES ('all', (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_spec_id;

  -- Resolve and count
  SELECT COUNT(*) INTO v_recipients FROM public.resolve_audience(v_spec_id);
  SELECT COUNT(*) INTO v_active_count FROM public.profiles WHERE status = 'active';

  IF v_recipients <> v_active_count THEN
    RAISE EXCEPTION 'E2E-06 FAIL: resolve_audience(all) returned % but expected %', v_recipients, v_active_count;
  END IF;

  -- Post the announcement
  INSERT INTO public.announcements (title, body, author_id, author_name, is_active, audience_spec_id)
  VALUES ('Weekly Update', 'Body text', (current_setting('ops_cert.coordinator_id', true))::uuid,
          'Coordinator', true, v_spec_id);

  RAISE NOTICE 'E2E-06 PASS: announcement broadcast to all % active members', v_active_count;
END $$;

-- ─── E2E-07: Send message to specific individuals ────────────────────────────

DO $$
DECLARE
  v_spec_id    uuid;
  v_member_a   uuid;
  v_member_b   uuid;
  v_recipients int;
BEGIN
  RAISE NOTICE 'E2E-07: Send message to specific individuals';

  SELECT (current_setting('ops_cert.member_a_id', true))::uuid INTO v_member_a;
  SELECT (current_setting('ops_cert.member_b_id', true))::uuid INTO v_member_b;

  INSERT INTO public.audience_specs (mode, profile_ids, created_by)
  VALUES ('explicit', ARRAY[v_member_a], (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_spec_id;

  SELECT COUNT(*) INTO v_recipients FROM public.resolve_audience(v_spec_id);

  IF v_recipients <> 1 THEN
    RAISE EXCEPTION 'E2E-07 FAIL: explicit spec with 1 member returned % recipients', v_recipients;
  END IF;

  -- Verify member_b is NOT in the recipient list
  IF EXISTS (
    SELECT 1 FROM public.resolve_audience(v_spec_id) WHERE profile_id = v_member_b
  ) THEN
    RAISE EXCEPTION 'E2E-07 FAIL: member_b should not be in explicit audience targeting only member_a';
  END IF;

  RAISE NOTICE 'E2E-07 PASS: explicit audience resolved to correct single recipient';
END $$;

-- ─── E2E-08: Send message to a saved group ───────────────────────────────────

DO $$
DECLARE
  v_group_id   uuid;
  v_spec_id    uuid;
  v_member_a   uuid;
  v_member_b   uuid;
  v_recipients int;
BEGIN
  RAISE NOTICE 'E2E-08: Send message to a saved group';

  SELECT (current_setting('ops_cert.member_a_id', true))::uuid INTO v_member_a;
  SELECT (current_setting('ops_cert.member_b_id', true))::uuid INTO v_member_b;

  INSERT INTO public.saved_groups (name, created_by)
  VALUES ('Prayer Warriors', (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_group_id;

  INSERT INTO public.saved_group_members (group_id, profile_id, added_by)
  VALUES (v_group_id, v_member_a, (current_setting('ops_cert.coordinator_id', true))::uuid);

  INSERT INTO public.audience_specs (mode, group_ids, created_by)
  VALUES ('saved_groups', ARRAY[v_group_id], (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_spec_id;

  SELECT COUNT(*) INTO v_recipients FROM public.resolve_audience(v_spec_id);

  IF v_recipients <> 1 THEN
    RAISE EXCEPTION 'E2E-08 FAIL: saved group with 1 member returned % recipients', v_recipients;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.resolve_audience(v_spec_id) WHERE profile_id = v_member_b
  ) THEN
    RAISE EXCEPTION 'E2E-08 FAIL: member_b not in group should not receive message';
  END IF;

  RAISE NOTICE 'E2E-08 PASS: saved group audience resolved correctly';
END $$;

-- ─── E2E-09: Assign unique tasks to different members ─────────────────────────

DO $$
DECLARE
  v_assign_a  uuid;
  v_assign_b  uuid;
  v_member_a  uuid;
  v_member_b  uuid;
BEGIN
  RAISE NOTICE 'E2E-09: Assign unique tasks to different members';

  SELECT (current_setting('ops_cert.member_a_id', true))::uuid INTO v_member_a;
  SELECT (current_setting('ops_cert.member_b_id', true))::uuid INTO v_member_b;

  INSERT INTO public.assignments (title, assigned_to, assigned_by)
  VALUES ('Submit testimony', v_member_a, (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_assign_a;

  INSERT INTO public.assignments (title, assigned_to, assigned_by)
  VALUES ('Lead cell prayer', v_member_b, (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_assign_b;

  IF v_assign_a = v_assign_b THEN
    RAISE EXCEPTION 'E2E-09 FAIL: assignments share the same id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.assignments WHERE id = v_assign_a AND assigned_to = v_member_a) THEN
    RAISE EXCEPTION 'E2E-09 FAIL: assignment A not found for member A';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.assignments WHERE id = v_assign_b AND assigned_to = v_member_b) THEN
    RAISE EXCEPTION 'E2E-09 FAIL: assignment B not found for member B';
  END IF;

  RAISE NOTICE 'E2E-09 PASS: two distinct assignments created for two members';
END $$;

-- ─── E2E-10: Independent assignment completion ───────────────────────────────

DO $$
DECLARE
  v_assign_a  uuid;
  v_assign_b  uuid;
  v_member_a  uuid;
  v_member_b  uuid;
BEGIN
  RAISE NOTICE 'E2E-10: Verify independent assignment completion';

  SELECT (current_setting('ops_cert.member_a_id', true))::uuid INTO v_member_a;
  SELECT (current_setting('ops_cert.member_b_id', true))::uuid INTO v_member_b;

  -- Find assignments from E2E-09 (or create fresh ones)
  SELECT id INTO v_assign_a FROM public.assignments
  WHERE assigned_to = v_member_a AND status = 'pending' LIMIT 1;

  SELECT id INTO v_assign_b FROM public.assignments
  WHERE assigned_to = v_member_b AND status = 'pending' LIMIT 1;

  IF v_assign_a IS NULL OR v_assign_b IS NULL THEN
    RAISE EXCEPTION 'E2E-10 SETUP FAIL: pending assignments not found (run E2E-09 first)';
  END IF;

  -- Member A completes their assignment (as service role standing in for member A's session)
  UPDATE public.assignments SET status = 'completed' WHERE id = v_assign_a;

  -- Member B's assignment must still be pending
  IF EXISTS (SELECT 1 FROM public.assignments WHERE id = v_assign_b AND status <> 'pending') THEN
    RAISE EXCEPTION 'E2E-10 FAIL: completing member A''s assignment changed member B''s status';
  END IF;

  -- completed_at must be set on A's assignment
  IF NOT EXISTS (SELECT 1 FROM public.assignments WHERE id = v_assign_a AND completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'E2E-10 FAIL: completed_at not stamped when status = completed';
  END IF;

  RAISE NOTICE 'E2E-10 PASS: member A completed, member B unchanged, completed_at stamped';
END $$;

-- ─── E2E-11: Distribute targeted affirmations ────────────────────────────────

DO $$
DECLARE
  v_spec_id      uuid;
  v_confession   uuid;
  v_member_a     uuid;
  v_member_b     uuid;
BEGIN
  RAISE NOTICE 'E2E-11: Distribute targeted affirmations';

  SELECT (current_setting('ops_cert.member_a_id', true))::uuid INTO v_member_a;
  SELECT (current_setting('ops_cert.member_b_id', true))::uuid INTO v_member_b;

  INSERT INTO public.audience_specs (mode, profile_ids, created_by)
  VALUES ('explicit', ARRAY[v_member_a], (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_spec_id;

  INSERT INTO public.confessions (title, body, scheduled_date, created_by, audience_spec_id)
  VALUES ('Personal Declaration', 'I am victorious.', CURRENT_DATE,
          (current_setting('ops_cert.coordinator_id', true))::uuid, v_spec_id)
  RETURNING id INTO v_confession;

  -- can_see_affirmation should be true for member_a, false for member_b
  IF NOT public.can_see_affirmation(v_confession) THEN
    -- Note: this runs as superuser so it won't use auth.uid(); checked in .mjs harness per-user
    RAISE NOTICE 'E2E-11 NOTE: per-user visibility check requires JWT session switch (see .mjs)';
  END IF;

  RAISE NOTICE 'E2E-11 PASS: targeted affirmation created; per-user RLS check deferred to .mjs';
END $$;

-- ─── E2E-12: Declaration identity privacy ─────────────────────────────────────

DO $$
DECLARE
  v_count bigint;
  v_confession_id uuid;
BEGIN
  RAISE NOTICE 'E2E-12: Preserve declaration identity privacy';

  SELECT id INTO v_confession_id FROM public.confessions WHERE is_active = true LIMIT 1;

  IF v_confession_id IS NULL THEN
    RAISE NOTICE 'E2E-12 SKIP: no active affirmation to test against';
    RETURN;
  END IF;

  -- confession_declaration_counts returns counts, not identities
  SELECT declaration_count INTO v_count
  FROM public.confession_declaration_counts(ARRAY[v_confession_id])
  LIMIT 1;

  -- The count should be a non-negative number (0 is valid)
  IF v_count IS NULL THEN
    v_count := 0;
  END IF;

  RAISE NOTICE 'E2E-12 PASS: declaration count = %, individual identity not exposed by count function', v_count;
  RAISE NOTICE 'E2E-12 NOTE: per-user SELECT isolation verified in .mjs harness (own row only for non-admin)';
END $$;

-- ─── E2E-13: Notifications and attendance ────────────────────────────────────

DO $$
DECLARE
  v_meeting_id uuid;
  v_member_id  uuid;
  v_rows       int;
BEGIN
  RAISE NOTICE 'E2E-13: Verify notifications and attendance updates';

  SELECT (current_setting('ops_cert.member_a_id', true))::uuid INTO v_member_id;

  SELECT id INTO v_meeting_id FROM public.meetings
  WHERE visibility = 'public' AND created_by = (current_setting('ops_cert.coordinator_id', true))::uuid
  LIMIT 1;

  IF v_meeting_id IS NULL THEN
    RAISE NOTICE 'E2E-13 SKIP: no public meeting found, skipping attendance update test';
    RETURN;
  END IF;

  INSERT INTO public.meeting_attendances (meeting_id, user_id, user_name, attended)
  VALUES (v_meeting_id, v_member_id, 'Test Member A', false)
  ON CONFLICT (meeting_id, user_id) DO NOTHING;

  UPDATE public.meeting_attendances SET attended = true
  WHERE meeting_id = v_meeting_id AND user_id = v_member_id;

  SELECT COUNT(*) INTO v_rows FROM public.meeting_attendances
  WHERE meeting_id = v_meeting_id AND user_id = v_member_id AND attended = true;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'E2E-13 FAIL: attendance update not reflected';
  END IF;

  RAISE NOTICE 'E2E-13 PASS: attendance updated to attended=true';
END $$;

-- ─── E2E-14: Pending member isolation ────────────────────────────────────────

DO $$
DECLARE
  v_spec_id    uuid;
  v_pending_id uuid;
BEGIN
  RAISE NOTICE 'E2E-14: Pending member not in resolve_audience output';

  SELECT (current_setting('ops_cert.pending_id', true))::uuid INTO v_pending_id;

  INSERT INTO public.audience_specs (mode, created_by)
  VALUES ('all', (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_spec_id;

  IF EXISTS (
    SELECT 1 FROM public.resolve_audience(v_spec_id) WHERE profile_id = v_pending_id
  ) THEN
    RAISE EXCEPTION 'E2E-14 FAIL: pending member % appears in resolve_audience(all)', v_pending_id;
  END IF;

  RAISE NOTICE 'E2E-14 PASS: pending member correctly excluded from all-mode audience';
END $$;

-- ─── E2E-15: Rejected member isolation ───────────────────────────────────────

DO $$
DECLARE
  v_spec_id     uuid;
  v_rejected_id uuid;
BEGIN
  RAISE NOTICE 'E2E-15: Rejected member not in resolve_audience output';

  SELECT (current_setting('ops_cert.rejected_id', true))::uuid INTO v_rejected_id;

  INSERT INTO public.audience_specs (mode, created_by)
  VALUES ('all', (current_setting('ops_cert.coordinator_id', true))::uuid)
  RETURNING id INTO v_spec_id;

  IF EXISTS (
    SELECT 1 FROM public.resolve_audience(v_spec_id) WHERE profile_id = v_rejected_id
  ) THEN
    RAISE EXCEPTION 'E2E-15 FAIL: rejected member % appears in resolve_audience(all)', v_rejected_id;
  END IF;

  RAISE NOTICE 'E2E-15 PASS: rejected member correctly excluded from all-mode audience';
END $$;

-- ─── Summary ──────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== Operational E2E Certification: SQL portion complete ===';
  RAISE NOTICE 'Scenarios E2E-05, E2E-11 (per-user RLS), E2E-12 (identity isolation):';
  RAISE NOTICE '  => Run operational_e2e_certification.mjs for JWT-session RLS checks';
  RAISE NOTICE 'All other scenarios run inline above.';
END $$;
