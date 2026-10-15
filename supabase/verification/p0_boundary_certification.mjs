// p0_boundary_certification.mjs
// Behavioural proof, through the real local API and the real send-email Edge Function, of:
//   A. meeting-attendance INSERT scope (migrations 034 + 036): visibility, cross-cell, lifecycle, duplicates;
//   B. email recipient identity: a memberId must belong to the destination address; lifecycle and preference
//      outcomes for unknown / opted-out / pending / rejected / inactive / active recipients; resend + schedule paths.
// Local stack only (lib.mjs refuses anything else). No real email is sent: allowed sends stop at the
// EMAIL_PROVIDER_NOT_CONFIGURED boundary (HTTP 500), which is how "reached the provider" is detected.
import { harness } from './lib.mjs';

const h = harness('p0-boundary');
const { admin, expect } = h;
const fnUrl = process.env.SUPABASE_FUNCTIONS_URL ?? `${h.url}/functions/v1`;
const cronSecret = process.env.CERT_CRON_SECRET ?? '';
const rnd = () => Math.random().toString(36).slice(2, 10);
const cleanup = { cells: [], meetings: [], logs: [], scheduled: [] };

const send = (u, body) =>
  fetch(`${fnUrl}/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}`, apikey: h.anonKey },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
const reachedProvider = (r) => r.status === 500 && /EMAIL_PROVIDER_NOT_CONFIGURED/.test(r.text);
const skipped = (r) => r.status === 200 && /"skipped":true|"skipped":[1-9]/.test(r.text);
const rowsFor = async (email) => (await admin.from('email_log').select('id,status,failed_reason').eq('recipient_email', email)).data ?? [];

try {
  const coordinator = await h.createUser('coord', { role: 'coordinator', status: 'active' });
  const leaderA = await h.createUser('leaderA', { role: 'cell_leader', status: 'active' });
  const leaderB = await h.createUser('leaderB', { role: 'cell_leader', status: 'active' });
  const member = await h.createUser('member', { role: 'member', status: 'active' });
  const member2 = await h.createUser('member2', { role: 'member', status: 'active' });
  const pending = await h.createUser('pending', { role: 'member', status: 'pending' });
  const rejected = await h.createUser('rejected', { role: 'member', status: 'rejected' });
  const inactive = await h.createUser('inactive', { role: 'member', status: 'inactive' });

  const mkCell = async (leaderId) => {
    const { data, error } = await admin.from('cells').insert({ name: `Boundary ${rnd()}`, leader_id: leaderId }).select('id').single();
    if (error) throw new Error(error.message);
    cleanup.cells.push(data.id);
    return data.id;
  };
  const cellA = await mkCell(leaderA.id);
  const cellB = await mkCell(leaderB.id);
 
  await admin.from('profiles').update({ cell_id: cellA }).eq('id', member.id);
  const memberB = await h.createUser('memberB', { role: 'member', status: 'active', cellId: cellB });
  const today = new Date().toISOString().split('T')[0];
  const mkMeeting = async (cellId, createdBy, visibility) => {
    const { data, error } = await admin.from('meetings').insert({ title: `Boundary ${rnd()}`, date: today, time: '19:00', visibility, cell_id: cellId, created_by: createdBy, category: 'cell' }).select('id').single();
    if (error) throw new Error(error.message);
    cleanup.meetings.push(data.id);
    return data.id;
  };
  const mPublicA = await mkMeeting(cellA, leaderA.id, 'public');
  const mLeadersA = await mkMeeting(cellA, leaderA.id, 'leaders');
  const mPublicB = await mkMeeting(cellB, leaderB.id, 'public');
  const row = (meetingId, u) => ({ meeting_id: meetingId, user_id: u.id, user_name: 'Boundary' });
  const count = async (meetingId, userId) => (await admin.from('meeting_attendances').select('id', { count: 'exact', head: true }).eq('meeting_id', meetingId).eq('user_id', userId)).count;

  // ==== A. Attendance INSERT scope =====================================================================================
  const selfPublic = await member.client.from('meeting_attendances').insert(row(mPublicA, member)).select();
  expect('A1 an active member can register themselves for a visible meeting', !selfPublic.error, selfPublic.error?.message);
  const selfHidden = await member.client.from('meeting_attendances').insert(row(mLeadersA, member)).select();
  expect("A2 a member cannot register for a meeting they cannot see ('leaders' visibility)", !!selfHidden.error && (await count(mLeadersA, member.id)) === 0, selfHidden.error?.message ?? 'inserted');
  const forge = await member.client.from('meeting_attendances').insert(row(mPublicA, member2)).select();
  expect('A3 a member cannot register someone else', !!forge.error && (await count(mPublicA, member2.id)) === 0);
  const coordAdd = await coordinator.client.from('meeting_attendances').insert(row(mPublicA, member2)).select();
  expect('A4 a coordinator can add an active member who never confirmed', !coordAdd.error && (await count(mPublicA, member2.id)) === 1, coordAdd.error?.message);
  for (const [label, target] of [['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const r = await coordinator.client.from('meeting_attendances').insert(row(mPublicA, target)).select();
    expect(`A5 a coordinator cannot add a ${label} account to a roster`, !!r.error && (await count(mPublicA, target.id)) === 0, r.error?.message ?? 'inserted');
  }
  const leaderOwn = await leaderA.client.from('meeting_attendances').insert(row(mLeadersA, member)).select();
  expect("A6 a cell leader can add an active member to a meeting in their own cell", !leaderOwn.error && (await count(mLeadersA, member.id)) === 1, leaderOwn.error?.message);
  for (const [label, target] of [['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const r = await leaderA.client.from('meeting_attendances').insert(row(mPublicA, target)).select();
    expect(`A6b a cell leader cannot add a ${label} account to their own meeting`, !!r.error && (await count(mPublicA, target.id)) === 0, r.error?.message ?? 'inserted');
  }
  const leaderOtherCellMember = await leaderA.client.from('meeting_attendances').insert(row(mPublicA, memberB)).select();
  expect("A6c scope is the MEETING: a leader can add an active member from another cell to their own cell's meeting", !leaderOtherCellMember.error, leaderOtherCellMember.error?.message);
  const leaderCross = await leaderA.client.from('meeting_attendances').insert(row(mPublicB, member)).select();
  expect("A7 a cell leader cannot add anyone to another cell's meeting", !!leaderCross.error && (await count(mPublicB, member.id)) === 0, leaderCross.error?.message ?? 'inserted');
  const leaderCross2 = await leaderB.client.from('meeting_attendances').insert(row(mPublicA, member)).select();
  expect("A8 the other cell's leader is likewise denied (symmetry)", !!leaderCross2.error, 'inserted');
  const dup = await coordinator.client.from('meeting_attendances').insert(row(mPublicA, member2)).select();
  expect('A9 a duplicate (meeting, user) insert is rejected and leaves exactly one row', !!dup.error && (await count(mPublicA, member2.id)) === 1, dup.error?.message);
  const raceTarget = await h.createUser('race', { role: 'member', status: 'active' });
  const race = await Promise.all(Array.from({ length: 6 }, () => coordinator.client.from('meeting_attendances').insert(row(mPublicA, raceTarget)).select()));
  expect('A10 six concurrent duplicate inserts leave exactly one row', (await count(mPublicA, raceTarget.id)) === 1 && race.filter((r) => !r.error).length === 1, `ok=${race.filter((r) => !r.error).length}`);
  for (const [label, actor] of [['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const self = await actor.client.from('meeting_attendances').insert(row(mPublicA, actor)).select();
    const other = await actor.client.from('meeting_attendances').insert(row(mPublicA, member)).select();
    expect(`A11 a ${label} account cannot register itself or anyone else`, !!self.error && !!other.error, `self=${self.error ? 'denied' : 'ALLOWED'} other=${other.error ? 'denied' : 'ALLOWED'}`);
  }
  const anon = await h.newAnon().from('meeting_attendances').insert(row(mPublicA, member)).select();
  expect('A12 anonymous callers cannot insert', !!anon.error);
  const upd = await member.client.from('meeting_attendances').update({ attended: true }).eq('meeting_id', mPublicA).eq('user_id', member.id).select();
  expect('A13 inserting rights did not widen UPDATE: a member still cannot mark themselves attended', (upd.data ?? []).length === 0, `rows=${upd.data?.length}`);

  // ==== B. Email recipient identity ====================================================================================
  const strangerFor = (tag) => `stranger.${tag}.${rnd()}@example.test`;
  const marker = () => `identity-${rnd()}`;
  await admin.from('email_preferences').upsert({ user_id: member.id, opt_out_all: false, admin_announcements: true }, { onConflict: 'user_id' });

  const s1 = strangerFor('send');
  const mismatch = await send(coordinator, { action: 'send', to: s1, memberId: member.id, subject: marker(), html: '<p>x</p>', templateType: 'generic' });
  expect('B1 an active, opted-in memberId paired with a stranger address is skipped as recipient-mismatch (no provider dispatch)', skipped(mismatch) && /recipient-mismatch/.test(mismatch.text), `${mismatch.status} ${mismatch.text.slice(0, 140)}`);
  expect('B2 the mismatched send is rejected BEFORE logging: no email_log row exists for the stranger address', (await rowsFor(s1)).length === 0, JSON.stringify(await rowsFor(s1)));

  const s2 = strangerFor('batch');
  const batchMismatch = await send(coordinator, { action: 'batch', recipients: [{ email: s2, memberId: member.id }], subject: marker(), html: '<p>x</p>', templateType: 'generic' });
  expect('B3 batch: the same mismatch is skipped, not dispatched, and not logged', !reachedProvider(batchMismatch) && (await rowsFor(s2)).length === 0, `${batchMismatch.status} ${batchMismatch.text.slice(0, 140)}`);

  const matchOk = await send(coordinator, { action: 'send', to: member.email, memberId: member.id, subject: marker(), html: '<p>x</p>', templateType: 'generic' });
  (await rowsFor(member.email)).forEach((r) => cleanup.logs.push(r.id));
  expect('B4 control: the matching active, opted-in member DOES reach the provider boundary', reachedProvider(matchOk), `${matchOk.status} ${matchOk.text.slice(0, 140)}`);
  const caseOk = await send(coordinator, { action: 'send', to: ` ${member.email.toUpperCase()} `, memberId: member.id, subject: marker(), html: '<p>x</p>', templateType: 'generic' });
  (await rowsFor(` ${member.email.toUpperCase()} `)).forEach((r) => cleanup.logs.push(r.id));
  expect('B5 the same address in different case / with whitespace still matches the member', reachedProvider(caseOk), `${caseOk.status} ${caseOk.text.slice(0, 140)}`);

  await admin.from('email_preferences').upsert({ user_id: member2.id, opt_out_all: true }, { onConflict: 'user_id' });
  const optOut = await send(coordinator, { action: 'send', to: member2.email, memberId: member2.id, subject: marker(), html: '<p>x</p>', templateType: 'generic' });
  const optRows = await rowsFor(member2.email);
  optRows.forEach((r) => cleanup.logs.push(r.id));
  expect('B6 an opted-out member (own address) is skipped, with only a skipped audit row', skipped(optOut) && optRows.length === 1 && optRows[0].status === 'skipped', `${optOut.status} rows=${JSON.stringify(optRows)}`);
  for (const [label, u] of [['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const r = await send(coordinator, { action: 'send', to: u.email, memberId: u.id, subject: marker(), html: '<p>x</p>', templateType: 'generic' });
    expect(`B7 a ${label} account (own address) is skipped, never dispatched, never logged`, skipped(r) && (await rowsFor(u.email)).length === 0, `${r.status} ${r.text.slice(0, 120)}`);
  }
  const s3 = strangerFor('unknown');
  const unknown = await send(coordinator, { action: 'send', to: s3, subject: marker(), html: '<p>x</p>', templateType: 'generic' });
  expect('B8 an unknown address with no memberId is skipped and not logged', skipped(unknown) && (await rowsFor(s3)).length === 0, `${unknown.status} ${unknown.text.slice(0, 120)}`);
  const bogus = await send(coordinator, { action: 'send', to: s3, memberId: '00000000-0000-0000-0000-000000000000', subject: marker(), html: '<p>x</p>', templateType: 'generic' });
  expect('B9 a memberId that matches no profile is skipped and not logged', skipped(bogus) && (await rowsFor(s3)).length === 0, `${bogus.status} ${bogus.text.slice(0, 120)}`);

  const s4 = strangerFor('txn');
  const txnMismatch = await send(coordinator, { action: 'send', to: s4, memberId: member.id, subject: marker(), html: '<p>x</p>', templateType: 'account_approved' });
  expect('B10 a transactional template also cannot pair a memberId with another address', skipped(txnMismatch) && (await rowsFor(s4)).length === 0, `${txnMismatch.status} ${txnMismatch.text.slice(0, 120)}`);
  const txnOk = await send(coordinator, { action: 'send', to: member.email, memberId: member.id, subject: marker(), html: '<p>x</p>', templateType: 'account_approved' });
  (await rowsFor(member.email)).forEach((r) => cleanup.logs.push(r.id));
  expect('B11 control: a transactional send to the member\'s own address reaches the provider boundary', reachedProvider(txnOk), `${txnOk.status} ${txnOk.text.slice(0, 120)}`);

  for (const [label, u] of [['member', member], ['cell leader', leaderA], ['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const r = await send(u, { action: 'send', to: member.email, memberId: member.id, subject: marker(), html: '<p>x</p>', templateType: 'generic' });
    expect(`B12 ${label} callers cannot use send-email at all`, r.status === 401 || r.status === 403, `status=${r.status}`);
  }

  // resend: the stored log row must still pass the identity + lifecycle + preference checks at resend time
  const insLog = async (memberId, recipient) => {
    const { data, error } = await admin.from('email_log').insert({ member_id: memberId, recipient_email: recipient, subject: marker(), template_type: 'generic', status: 'failed', html_content: '<p>x</p>' }).select('id').single();
    if (error) throw new Error(error.message);
    cleanup.logs.push(data.id);
    return data.id;
  };
  const resendBad = await send(coordinator, { action: 'resend', messageId: await insLog(member.id, strangerFor('resend')) });
  expect('B13 resend of a log row whose address does not belong to its member is skipped, not dispatched', !reachedProvider(resendBad) && /skipped/.test(resendBad.text), `${resendBad.status} ${resendBad.text.slice(0, 140)}`);
  const resendOpt = await send(coordinator, { action: 'resend', messageId: await insLog(member2.id, member2.email) });
  expect('B14 resend for a member who has since opted out is skipped', /skipped/.test(resendOpt.text) && !reachedProvider(resendOpt), `${resendOpt.status} ${resendOpt.text.slice(0, 140)}`);
  const resendOk = await send(coordinator, { action: 'resend', messageId: await insLog(member.id, member.email) });
  expect('B15 control: resend to the member\'s own address reaches the provider boundary', reachedProvider(resendOk), `${resendOk.status} ${resendOk.text.slice(0, 140)}`);

  // scheduled delivery: identity travels with the scheduled row and is enforced when the cron dispatches
  if (cronSecret) {
    const s5 = strangerFor('sched');
    const sched = await send(coordinator, { action: 'schedule', to: s5, memberId: member.id, subject: marker(), html: '<p>x</p>', scheduledFor: new Date(Date.now() - 60000).toISOString(), templateType: 'generic' });
    const schedId = JSON.parse(sched.text || '{}').id;
    if (schedId) cleanup.scheduled.push(schedId);
    const run = await fetch(`${fnUrl}/process-scheduled-emails`, { method: 'POST', headers: { 'x-cron-secret': cronSecret, apikey: h.anonKey, Authorization: `Bearer ${h.anonKey}` } });
    const runText = await run.text();
    expect('B16 a scheduled email pairing a memberId with a stranger address is skipped by the dispatcher and not logged', !!schedId && run.status === 200 && (await rowsFor(s5)).length === 0, `${run.status} ${runText.slice(0, 160)}`);
    const wrong = await fetch(`${fnUrl}/process-scheduled-emails`, { method: 'POST', headers: { 'x-cron-secret': 'wrong', apikey: h.anonKey, Authorization: `Bearer ${h.anonKey}` } });
    expect('B17 the dispatcher refuses a wrong cron secret', wrong.status === 401);
  } else {
    h.fail('B16/B17 scheduled dispatch checks', 'CERT_CRON_SECRET not provided - NOT EXECUTED');
  }
} catch (error) {
  h.fail('harness completed without error', error instanceof Error ? error.message : String(error));
} finally {
  try { if (cleanup.scheduled.length) await admin.from('scheduled_emails').delete().in('id', cleanup.scheduled); } catch { /* ignore */ }
  try { if (cleanup.logs.length) await admin.from('email_log').delete().in('id', cleanup.logs); } catch { /* ignore */ }
  try { if (cleanup.meetings.length) await admin.from('meetings').delete().in('id', cleanup.meetings); } catch { /* ignore */ }
  try { await h.cleanup(); } catch { /* ignore */ }
  try { if (cleanup.cells.length) await admin.from('cells').delete().in('id', cleanup.cells); } catch { /* ignore */ }
  h.report();
}
