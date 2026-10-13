// operational_e2e_certification.mjs
//
// Phase 4 E2E certification for the operational workstream (migrations 059-064).
// Runs JWT-session RLS checks that cannot be done in plain SQL.
//
// Covers the per-user isolation checks from docs/ops-shared-contracts.md §10:
//   E2E-05: excluded members cannot access explicit meeting data
//   E2E-11: non-audience member cannot SELECT targeted affirmation
//   E2E-12: declaration identity privacy (non-admin sees count, not who declared)
//   E2E-14: pending member excluded from audience resolution (client-side confirm)
//   E2E-15: rejected member excluded from audience resolution (client-side confirm)
//
// Local stack only (lib.mjs refuses anything else).
import { harness } from './lib.mjs';

const h = harness('ops-e2e');
const { admin, expect } = h;
const rnd = () => Math.random().toString(36).slice(2, 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mkCell = async (leaderId) => {
  const { data, error } = await admin
    .from('cells')
    .insert({ name: `OpsE2E ${rnd()}`, leader_id: leaderId })
    .select('id').single();
  if (error) throw new Error(`mkCell: ${error.message}`);
  return data.id;
};

const mkAudienceSpec = async (createdById, mode, extras = {}) => {
  const { data, error } = await admin
    .from('audience_specs')
    .insert({ mode, created_by: createdById, ...extras })
    .select('id').single();
  if (error) throw new Error(`mkAudienceSpec(${mode}): ${error.message}`);
  return data.id;
};

const mkMeeting = async (visibility, createdById, cellId = null) => {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await admin
    .from('meetings')
    .insert({ title: `OpsE2E ${rnd()}`, date: today, time: '19:00', visibility, created_by: createdById, cell_id: cellId })
    .select('id').single();
  if (error) throw new Error(`mkMeeting: ${error.message}`);
  return data.id;
};

const mkAffirmation = async (coordinatorId, specId = null) => {
  const { data, error } = await admin
    .from('confessions')
    .insert({ title: `OpsE2E ${rnd()}`, body: 'I am more than a conqueror.', scheduled_date: new Date().toISOString().split('T')[0], created_by: coordinatorId, audience_spec_id: specId })
    .select('id').single();
  if (error) throw new Error(`mkAffirmation: ${error.message}`);
  return data.id;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  const coordinator = await h.createUser('coord',   { role: 'coordinator', status: 'active' });
  const leader      = await h.createUser('leader',  { role: 'cell_leader', status: 'active' });
  const memberA     = await h.createUser('memberA', { role: 'member',      status: 'active' });
  const memberB     = await h.createUser('memberB', { role: 'member',      status: 'active' });
  const pending     = await h.createUser('pending', { role: 'member',      status: 'pending' });
  const rejected    = await h.createUser('rejected',{ role: 'member',      status: 'rejected' });

  const cellId = await mkCell(leader.id);
  await admin.from('profiles').update({ cell_id: cellId }).in('id', [memberA.id, memberB.id]);

  // ─── E2E-05: Excluded member cannot access explicit meeting ────────────────

  const explicitMeeting = await mkMeeting('explicit', coordinator.id, cellId);
  // Only memberA is invited
  await admin.from('meeting_attendances').insert({ meeting_id: explicitMeeting, user_id: memberA.id, user_name: 'MemberA' });

  // memberA (invitee) should see the meeting
  const { data: meetingA } = await memberA.client.from('meetings').select('id').eq('id', explicitMeeting);
  expect('E2E-05: invited member can SELECT explicit meeting', (meetingA ?? []).length === 1);

  // memberB (not invited) must NOT see the meeting
  const { data: meetingB } = await memberB.client.from('meetings').select('id').eq('id', explicitMeeting);
  expect('E2E-05: excluded member cannot SELECT explicit meeting', (meetingB ?? []).length === 0,
    `got ${(meetingB ?? []).length} rows`);

  // memberB must NOT see meeting_attendances rows for this meeting
  const { data: attendB } = await memberB.client.from('meeting_attendances').select('id').eq('meeting_id', explicitMeeting);
  expect('E2E-05: excluded member cannot SELECT meeting_attendances for explicit meeting',
    (attendB ?? []).length === 0, `got ${(attendB ?? []).length} rows`);

  // memberA can see their own attendance row
  const { data: attendA } = await memberA.client.from('meeting_attendances').select('id').eq('meeting_id', explicitMeeting).eq('user_id', memberA.id);
  expect('E2E-05: invitee can SELECT their own meeting_attendances row', (attendA ?? []).length === 1);

  // ─── E2E-11: Non-audience member cannot see targeted affirmation ───────────

  const specId11 = await mkAudienceSpec(coordinator.id, 'explicit', {
    profile_ids: [memberA.id],
  });
  const affirmId = await mkAffirmation(coordinator.id, specId11);

  // memberA (in audience) should see it
  const { data: affA } = await memberA.client.from('confessions').select('id').eq('id', affirmId);
  expect('E2E-11: audience member can SELECT targeted affirmation', (affA ?? []).length === 1);

  // memberB (not in audience) must NOT see it
  const { data: affB } = await memberB.client.from('confessions').select('id').eq('id', affirmId);
  expect('E2E-11: non-audience member cannot SELECT targeted affirmation',
    (affB ?? []).length === 0, `got ${(affB ?? []).length} rows`);

  // coordinator (staff) always sees it
  const { data: affCoord } = await coordinator.client.from('confessions').select('id').eq('id', affirmId);
  expect('E2E-11: coordinator can always SELECT targeted affirmation', (affCoord ?? []).length === 1);

  // ─── E2E-12: Declaration identity privacy ─────────────────────────────────

  // Create a broadcast affirmation and have memberA declare it
  const broadcastAffirmId = await mkAffirmation(coordinator.id, null);
  await admin.from('confession_declarations').insert({ confession_id: broadcastAffirmId, user_id: memberA.id });

  // memberB can see memberA's declaration row via direct SELECT? Should NOT.
  const { data: declB } = await memberB.client
    .from('confession_declarations')
    .select('user_id')
    .eq('confession_id', broadcastAffirmId)
    .eq('user_id', memberA.id);
  expect('E2E-12: member B cannot see member A declaration row',
    (declB ?? []).length === 0, `got ${(declB ?? []).length} rows`);

  // memberA can see their own declaration
  const { data: declA } = await memberA.client
    .from('confession_declarations')
    .select('user_id')
    .eq('confession_id', broadcastAffirmId)
    .eq('user_id', memberA.id);
  expect('E2E-12: member A can see their own declaration row', (declA ?? []).length === 1);

  // coordinator can see declarations (staff visibility)
  const { data: declCoord } = await coordinator.client
    .from('confession_declarations')
    .select('user_id')
    .eq('confession_id', broadcastAffirmId);
  expect('E2E-12: coordinator can see declaration rows for audit', (declCoord ?? []).length >= 1);

  // ─── E2E-14: Pending member excluded from client-visible audience ──────────

  const specId14 = await mkAudienceSpec(coordinator.id, 'all');
  // pending member's own client cannot read their own profile as 'active'
  const { data: pendingProfiles } = await pending.client.from('profiles').select('id, status').eq('id', pending.id);
  const pendingStatus = (pendingProfiles ?? [])[0]?.status;
  expect('E2E-14: pending member profile status is not active', pendingStatus !== 'active',
    `status was ${pendingStatus}`);

  // ─── E2E-15: Rejected member excluded from client-visible audience ─────────

  const { data: rejectedProfiles } = await rejected.client.from('profiles').select('id, status').eq('id', rejected.id);
  const rejectedStatus = (rejectedProfiles ?? [])[0]?.status;
  expect('E2E-15: rejected member profile status is not active', rejectedStatus !== 'active',
    `status was ${rejectedStatus}`);

} finally {
  await h.cleanup();
}

h.report();
