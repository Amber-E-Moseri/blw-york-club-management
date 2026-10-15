// authorization_certification.mjs
// Behavioural proof that privileged profile fields cannot be changed by the wrong people, that the signup trigger is
// authoritative, and that the RPC / table surface is exactly what the contract says. Runs real attempts through
// PostgREST as real (fake, throwaway) accounts, then re-reads the stored result with the service role, so an update
// that is silently ignored by RLS still counts as a denial.
import { harness } from './lib.mjs';

const h = harness('authorization');
const { admin, expect } = h;

async function attempt(label, userClient, fn) {
  const r = await fn(userClient);
  return { label, error: r.error ?? null, data: r.data ?? null };
}

try {
  const member = await h.createUser('member', { role: 'member', status: 'active' });
  const pending = await h.createUser('pending', { status: 'pending' });
  const leader = await h.createUser('leader', { role: 'cell_leader', status: 'active' });
  const adminUser = await h.createUser('admin', { role: 'admin', status: 'active' });
  const coordinator = await h.createUser('coordinator', { role: 'coordinator', status: 'active' });
  const victim = await h.createUser('victim', { role: 'member', status: 'active' });
  const target1 = await h.createUser('target1', { status: 'pending' });
  const target2 = await h.createUser('target2', { status: 'pending' });

  // ---- signup trigger is authoritative (real public signUp flow, hostile metadata) -------------------------------
  const variants = [
    ['no full_name, hostile role/status/admin_role', { role: 'coordinator', status: 'active', admin_role: 'superuser', cell_id: '00000000-0000-0000-0000-000000000000' }],
    ['empty full_name', { full_name: '', role: 'admin', status: 'active' }],
    ['status-only metadata', { status: 'active' }],
  ];
  for (const [label, data] of variants) {
    const email = `cert.authorization.signup.${h.run}.${Math.random().toString(36).slice(2, 8)}@example.test`;
    const { data: signed, error } = await h.newAnon().auth.signUp({ email, password: 'Aa1!' + Math.random().toString(36).repeat(3), options: { data } });
    if (error || !signed.user) {
      h.fail(`signup (${label}) could be performed`, error?.message);
      continue;
    }
    const profile = await h.profileOf(signed.user.id);
    expect(`signup (${label}) becomes member + pending with no admin_role`,
      profile.role === 'member' && profile.status === 'pending' && profile.admin_role == null, JSON.stringify(profile));
    await admin.auth.admin.deleteUser(signed.user.id);
  }

  // ---- direct self-promotion / self-activation is impossible ----------------------------------------------------------
  const privileged = [
    ['role', { role: 'coordinator' }],
    ['admin_role', { admin_role: 'superuser' }],
    ['status', { status: 'active' }],
  ];
  for (const [who, actor] of [['member', member], ['pending user', pending], ['cell leader', leader]]) {
    const before = await h.profileOf(actor.id);
    for (const [field, patch] of privileged) {
      await actor.client.from('profiles').update(patch).eq('id', actor.id).select();
      const after = await h.profileOf(actor.id);
      expect(`${who} cannot change own ${field}`, after[field] === before[field], `${field}: ${before[field]} -> ${after[field]}`);
    }
    // ...nor anyone else's
    const victimBefore = await h.profileOf(victim.id);
    await actor.client.from('profiles').update({ role: 'admin', status: 'rejected' }).eq('id', victim.id).select();
    const victimAfter = await h.profileOf(victim.id);
    expect(`${who} cannot change another member's role/status`, victimAfter.role === victimBefore.role && victimAfter.status === victimBefore.status, JSON.stringify(victimAfter));
  }

  // The admin role is not the coordinator role: it can approve through the RPC but cannot rewrite profiles directly.
  const victimBeforeAdmin = await h.profileOf(victim.id);
  await adminUser.client.from('profiles').update({ role: 'coordinator' }).eq('id', victim.id).select();
  expect('admin cannot promote through a direct profile update', (await h.profileOf(victim.id)).role === victimBeforeAdmin.role);

  // ---- controlled privileged operations work for the right people ---------------------------------------------------
  const approve = await coordinator.client.rpc('approve_pending_member', { target_member_id: target1.id });
  expect('coordinator can approve a pending member (RPC)', !approve.error && (await h.profileOf(target1.id)).status === 'active', approve.error?.message);
  const reject = await adminUser.client.rpc('reject_pending_member', { target_member_id: target2.id });
  expect('admin can reject a pending member (RPC)', !reject.error && (await h.profileOf(target2.id)).status === 'rejected', reject.error?.message);

  await coordinator.client.from('profiles').update({ role: 'cell_leader' }).eq('id', victim.id).select();
  expect('coordinator can change a role through a direct update', (await h.profileOf(victim.id)).role === 'cell_leader');
  await admin.from('profiles').update({ role: 'member' }).eq('id', victim.id);

  const exportRows = await coordinator.client.rpc('export_members_authorized', { export_status: 'all' });
  expect('coordinator can run the authorized member export', !exportRows.error, exportRows.error?.message);

  // ---- RPC surface: anon none, member only what is intended ----------------------------------------------------------
  const rpcs = [
    ['approve_pending_member', { target_member_id: victim.id }],
    ['reject_pending_member', { target_member_id: victim.id }],
    ['export_members_authorized', { export_status: 'all' }],
    ['merge_people', { target_person_id: victim.id, source_person_id: member.id, merge_notes: null }],
    ['bootstrap_first_administrator', { target_email: 'nobody@example.test', note: null }],
    ['is_coordinator', {}],
    ['is_admin_or_coordinator', {}],
    ['current_user_role', {}],
    ['has_admin_permission', { permission: 'reports.generate' }],
    ['handle_new_user', {}],
    ['set_updated_at', {}],
    ['guard_profile_privileged_columns', {}],
  ];
  for (const [fn, args] of rpcs) {
    const r = await h.newAnon().rpc(fn, args);
    expect(`anon cannot call ${fn}`, !!r.error && !r.data, r.error ? '' : 'call succeeded');
  }
  for (const [fn, args] of [
    ['approve_pending_member', { target_member_id: victim.id }],
    ['reject_pending_member', { target_member_id: victim.id }],
    ['export_members_authorized', { export_status: 'all' }],
    ['merge_people', { target_person_id: victim.id, source_person_id: member.id, merge_notes: null }],
    ['bootstrap_first_administrator', { target_email: 'nobody@example.test', note: null }],
    ['handle_new_user', {}],
    ['set_updated_at', {}],
    ['guard_profile_privileged_columns', {}],
  ]) {
    const r = await member.client.rpc(fn, args);
    expect(`ordinary member cannot call ${fn}`, !!r.error && !r.data, r.error ? '' : 'call succeeded');
  }
  const leaderApprove = await leader.client.rpc('approve_pending_member', { target_member_id: pending.id });
  expect('cell leader cannot approve members', !!leaderApprove.error && (await h.profileOf(pending.id)).status === 'pending', leaderApprove.error?.message);

  // ---- table surface ----------------------------------------------------------------------------------------------------
  for (const table of ['profiles', 'people', 'contacts', 'events', 'email_preferences', 'push_subscriptions', 'push_notification_log', 'scheduled_emails', 'memberships']) {
    const r = await h.newAnon().from(table).select('*').limit(1);
    expect(`anon is refused at the table level on ${table}`, !!r.error && r.error.code === '42501', r.error ? `${r.error.code} ${r.error.message}` : 'no error');
  }
  for (const table of ['scheduled_emails', 'admin_bootstrap_audit']) {
    const r = await member.client.from(table).select('*').limit(1);
    expect(`authenticated has no table privilege on ${table} (server-side only)`, !!r.error && r.error.code === '42501', r.error ? `${r.error.code}` : 'no error');
  }
  const attendanceSurface = await member.client.from('meeting_attendances').select('id').limit(1);
  expect('authenticated has scoped meeting_attendances access (RLS, not blanket server-only denial)', !attendanceSurface.error, attendanceSurface.error?.message);

  // ---- approval is enforced by the database, not by the screen ----------------------------------------------------------------
  const seeded = await admin.from('people').insert({ full_name: `Cert Person ${h.run}`, email: `cert.person.${h.run}@example.test` }).select('id').single();
  const rejectedUser = await h.createUser('rejected', { role: 'member', status: 'rejected' });
  const seenBy = async (client) => (await client.from('people').select('id').eq('id', seeded.data.id)).data?.length ?? -1;
  expect('an active member can read the people directory', (await seenBy(member.client)) === 1);
  expect('a pending account cannot read the people directory', (await seenBy(pending.client)) === 0);
  expect('a rejected account cannot read the people directory', (await seenBy(rejectedUser.client)) === 0);
  const pendingWrite = await pending.client.from('people').insert({ full_name: 'Written By Pending' }).select();
  expect('a pending account cannot create people records', !!pendingWrite.error, 'insert succeeded');
  const pendingDirectory = await pending.client.from('member_directory').select('id');
  expect('a pending account sees at most its own entry in the member directory', (pendingDirectory.data ?? []).every((r) => r.id === pending.id), `${(pendingDirectory.data ?? []).length} rows`);
  const ownProfile = await pending.client.from('profiles').select('id,status').eq('id', pending.id).maybeSingle();
  expect('a pending account can read its own profile (the approval screen needs it)', ownProfile.data?.status === 'pending', ownProfile.error?.message);

  // ---- F-4: pending account profile-edit behavioural contract --------------------------------------------------------
  // full_name is an ordinary column; the guard trigger does not block it and the RLS UPDATE policy should
  // allow a pending account to correct a typo before they are approved.
  const pendingNameBefore = (await admin.from('profiles').select('full_name').eq('id', pending.id).single()).data?.full_name;
  await pending.client.from('profiles').update({ full_name: 'F-4 Updated Name' }).eq('id', pending.id);
  const pendingNameAfter = (await admin.from('profiles').select('full_name').eq('id', pending.id).single()).data?.full_name;
  expect('F-4: pending account can update own full_name', pendingNameAfter === 'F-4 Updated Name', `before="${pendingNameBefore}" after="${pendingNameAfter}"`);

  // cell_id is a cell-assignment column; a pending account must not self-assign to bypass the approval workflow.
  const pendingCellBefore = (await admin.from('profiles').select('cell_id').eq('id', pending.id).single()).data?.cell_id ?? null;
  const anyCellRow = await admin.from('cells').select('id').limit(1).single();
  if (anyCellRow.data?.id) {
    await pending.client.from('profiles').update({ cell_id: anyCellRow.data.id }).eq('id', pending.id);
    const pendingCellAfter = (await admin.from('profiles').select('cell_id').eq('id', pending.id).single()).data?.cell_id ?? null;
    expect('F-4: pending account cannot self-assign a cell', pendingCellAfter === pendingCellBefore, `before="${pendingCellBefore}" after="${pendingCellAfter}"`);
  }

  // role, status and admin_role are already proven immovable in the self-promotion block above.
  // Summarise the result here so the F-4 family appears together in the cert report.
  const pendingProfileFinal = await h.profileOf(pending.id);
  expect('F-4: pending account role/status/admin_role unchanged throughout', pendingProfileFinal.role === 'member' && pendingProfileFinal.status === 'pending' && pendingProfileFinal.admin_role == null, JSON.stringify(pendingProfileFinal));

  await admin.from('people').delete().eq('id', seeded.data.id);
} catch (error) {
  h.fail('harness completed without error', error.message);
} finally {
  await h.cleanup();
  h.report();
}
