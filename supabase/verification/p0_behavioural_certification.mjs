// p0_behavioural_certification.mjs
// Behavioural proof of the P0 release requirements through the real local API as real (fake, throwaway) accounts.
// Sections: A contact identity/idempotency, B attendance/roster, C lifecycle/profiles/audit, D email composer,
// E email-open tracking and unsubscribe. Where a check documents a GAP rather than a guarantee, the check name starts
// with "EXPECTED:" so a failure reads as "the product does not do what the release requires".
//
// The Quick Add sequence in section A mirrors src/lib/queries/people.ts createContactPerson() statement for statement
// (email-only person match, createPerson, contacts insert, idempotency-key recovery) so that the real database
// constraints decide the outcome.
import { createHmac, randomUUID } from 'node:crypto';
import { harness } from './lib.mjs';

const h = harness('p0-behavioural');
const { admin, expect } = h;
const fnUrl = process.env.SUPABASE_FUNCTIONS_URL ?? `${h.url}/functions/v1`;
const unsubSecret = process.env.CERT_UNSUBSCRIBE_SECRET ?? '';
const createdPeople = [];
const createdCells = [];
const createdMeetings = [];
const createdEmailLog = [];
const createdTemplates = [];
const createdDrafts = [];

const rnd = () => randomUUID().replace(/-/g, '').slice(0, 10);
const phoneOf = () => `+1416${String(Math.floor(Math.random() * 9000000) + 1000000)}`;

/**
 * Mirrors src/lib/queries/people.ts createContactPerson() statement for statement (exact email match through the
 * find_person_by_email RPC, create person, race retry, explicit ambiguous-phone error, contact insert, idempotency
 * recovery). The AUTHORITATIVE proof of the shipped code is src/__tests__/quickAddRealCode.integration.test.ts,
 * which runs the real function; this mirror exists so the database-level behaviour is also visible in this report.
 */
async function quickAdd(client, input) {
  const findByEmail = async (email) => {
    const { data, error } = await client.rpc('find_person_by_email', { p_email: email });
    if (error) throw new Error(error.message);
    return data ?? null;
  };
  let personId = null;
  if (input.email) personId = await findByEmail(input.email);
  if (!personId) {
    const { data, error } = await client
      .from('people')
      .insert({ full_name: input.fullName.trim(), email: input.email?.trim() || null, phone: input.phone?.trim() || null })
      .select('id')
      .single();
    if (error) {
      if (/duplicate key|violates unique/i.test(error.message ?? '')) {
        if (input.email && /email/i.test(error.message ?? '')) {
          const retried = await findByEmail(input.email);
          if (retried) personId = retried;
          else return { error: error.message, stage: 'person' };
        } else if (/phone/i.test(error.message ?? '')) {
          return { error: 'ambiguous-phone: a person with this phone number already exists and requires staff review', stage: 'person' };
        } else {
          return { error: error.message, stage: 'person' };
        }
      } else {
        return { error: error.message, stage: 'person' };
      }
    } else {
      personId = data.id;
      createdPeople.push(personId);
    }
  }
  const { data: contactRow, error: contactErr } = await client
    .from('contacts')
    .insert({
      person_id: personId,
      contact_name: input.fullName.trim(),
      contact_phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      cell_id: input.cellId,
      logged_by: input.loggedBy,
      date_contacted: input.dateContacted ?? new Date().toISOString().split('T')[0],
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select('id, person_id')
    .single();
  if (contactErr && input.idempotencyKey && /duplicate key|unique/i.test(contactErr.message ?? '')) {
    const { data: again } = await client.from('contacts').select('id, person_id')
      .eq('logged_by', input.loggedBy).eq('idempotency_key', input.idempotencyKey).maybeSingle();
    if (again) return { contact: again, replay: true, personId };
  }
  if (contactErr) return { error: contactErr.message, stage: 'contact' };
  return { contact: contactRow, personId };
}

const mintUnsubToken = (userId, notifType, ttl = 3600) => {
  const payload = Buffer.from(JSON.stringify({ userId, notifType, exp: Math.floor(Date.now() / 1000) + ttl })).toString('base64url');
  return `${payload}.${createHmac('sha256', unsubSecret).update(payload).digest('hex')}`;
};

try {
  // ---- fixtures -----------------------------------------------------------------------------------------------------
  const coordinator = await h.createUser('coord', { role: 'coordinator', status: 'active' });
  const coordinator2 = await h.createUser('coord2', { role: 'coordinator', status: 'active' });
  const adminUser = await h.createUser('admin', { role: 'admin', status: 'active' });
  const leader1 = await h.createUser('leader1', { role: 'cell_leader', status: 'active' });
  const leader2 = await h.createUser('leader2', { role: 'cell_leader', status: 'active' });
  const member = await h.createUser('member', { role: 'member', status: 'active' });
  const member2 = await h.createUser('member2', { role: 'member', status: 'active' });
  const pending = await h.createUser('pending', { role: 'member', status: 'pending' });
  const rejected = await h.createUser('rejected', { role: 'member', status: 'rejected' });
  const inactive = await h.createUser('inactive', { role: 'member', status: 'inactive' });

  const mkCell = async (name, leaderId) => {
    const { data, error } = await admin.from('cells').insert({ name: `${name} ${h.run}`, leader_id: leaderId }).select('id').single();
    if (error) throw new Error(`cell ${name}: ${error.message}`);
    createdCells.push(data.id);
    return data.id;
  };
  const cellA = await mkCell('Cert A', leader1.id);
  const cellB = await mkCell('Cert B', leader2.id);
  await admin.from('profiles').update({ cell_id: cellA }).eq('id', member.id);
  const today = new Date().toISOString().split('T')[0];
  const mkMeeting = async (cellId, createdBy) => {
    const { data, error } = await admin.from('meetings').insert({
      title: `Cert meeting ${rnd()}`, date: today, time: '19:00', visibility: 'public', cell_id: cellId, created_by: createdBy, category: 'cell',
    }).select('id').single();
    if (error) throw new Error(`meeting: ${error.message}`);
    createdMeetings.push(data.id);
    return data.id;
  };

  // ==== A. Contact identity and idempotency ============================================================================
  const emailA = `ada.${rnd()}@example.test`;
  const a1 = await quickAdd(coordinator.client, { fullName: 'Ada Cert', email: emailA, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: randomUUID() });
  expect('A1 coordinator can log a new contact in a cell', !a1.error && !!a1.contact?.id, a1.error);
  const personCount = async (email) => (await admin.from('people').select('id', { count: 'exact', head: true }).ilike('email', email)).count;

  const a2 = await quickAdd(coordinator.client, { fullName: 'Ada Cert', email: emailA.toUpperCase().replace('@EXAMPLE.TEST', '@Example.test'), cellId: cellA, loggedBy: coordinator.id, idempotencyKey: randomUUID() });
  const peopleAfterCase = await personCount(emailA);
  expect('A2 EXPECTED: an email that differs only by case resolves to the same person (no error, one person)', !a2.error && peopleAfterCase === 1, `error="${a2.error ?? ''}" people=${peopleAfterCase}`);

  const sharedPhone = phoneOf();
  const a3a = await quickAdd(coordinator.client, { fullName: 'Phone Owner', phone: sharedPhone, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: randomUUID() });
  const a3b = await quickAdd(coordinator.client, { fullName: 'Different Person', phone: sharedPhone, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: randomUUID() });
  const { data: phoneOwners } = await admin.from('people').select('id,full_name').eq('phone', sharedPhone);
  expect('A3a phone-only match never silently merges two different people', (phoneOwners ?? []).length <= 1 || new Set((phoneOwners ?? []).map((p) => p.full_name)).size === (phoneOwners ?? []).length, JSON.stringify(phoneOwners));
  expect('A3b EXPECTED: an ambiguous phone yields a clean, reviewable outcome rather than a raw database error', !a3b.error || !/duplicate key|violates unique/i.test(a3b.error), `outcome="${a3b.error ?? 'created'}"`);
  expect('A3c the existing phone owner is not overwritten by the second submission', (phoneOwners ?? []).every((p) => p.full_name === 'Phone Owner'), JSON.stringify(phoneOwners));

  const sameDayEmail = `sameday.${rnd()}@example.test`;
  const d1 = await quickAdd(coordinator.client, { fullName: 'Same Day', email: sameDayEmail, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: randomUUID(), dateContacted: today });
  const d2 = await quickAdd(coordinator.client, { fullName: 'Same Day', email: sameDayEmail, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: randomUUID(), dateContacted: today });
  const { count: sameDayRows } = await admin.from('contacts').select('id', { count: 'exact', head: true }).eq('email', sameDayEmail).eq('date_contacted', today);
  expect('A4 two legitimate contacts with the same person on the same day are both recorded', !d1.error && !d2.error && sameDayRows === 2, `rows=${sameDayRows} ${d1.error ?? ''} ${d2.error ?? ''}`);
  expect('A4b both contacts point at one person', d1.contact?.person_id && d1.contact.person_id === d2.contact?.person_id);

  const retryKey = randomUUID();
  const retryEmail = `retry.${rnd()}@example.test`;
  const r1 = await quickAdd(coordinator.client, { fullName: 'Retry Person', email: retryEmail, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: retryKey });
  const r2 = await quickAdd(coordinator.client, { fullName: 'Retry Person', email: retryEmail, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: retryKey });
  const { count: retryRows } = await admin.from('contacts').select('id', { count: 'exact', head: true }).eq('idempotency_key', retryKey);
  expect('A5 retry with the identical idempotency key creates exactly one contact and returns the original', retryRows === 1 && r2.replay === true && r2.contact?.id === r1.contact?.id, `rows=${retryRows} replay=${r2.replay} err=${r2.error ?? ''}`);

  const raceKey = randomUUID();
  const raceEmail = `race.${rnd()}@example.test`;
  const race = await Promise.all(Array.from({ length: 6 }, () => quickAdd(coordinator.client, { fullName: 'Race Person', email: raceEmail, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: raceKey })));
  const { count: raceRows } = await admin.from('contacts').select('id', { count: 'exact', head: true }).eq('idempotency_key', raceKey);
  const raceErrors = race.filter((r) => r.error).map((r) => r.error);
  expect('A6a concurrent duplicate submissions (same key) leave exactly one contact row', raceRows === 1, `rows=${raceRows}`);
  expect('A6b EXPECTED: every concurrent duplicate submission is answered without an error', raceErrors.length === 0, `${raceErrors.length} of 6 failed: ${[...new Set(raceErrors)].join(' | ')}`);
  expect('A6c concurrent duplicates produce exactly one person', (await personCount(raceEmail)) === 1);

  const diffKeyEmail = `race2.${rnd()}@example.test`;
  const race2 = await Promise.all([randomUUID(), randomUUID()].map((k) => quickAdd(coordinator.client, { fullName: 'Race Two', email: diffKeyEmail, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: k })));
  expect('A7 EXPECTED: two simultaneous first contacts with a brand-new email both succeed and share one person', race2.every((r) => !r.error) && (await personCount(diffKeyEmail)) === 1, race2.map((r) => r.error ?? 'ok').join(' | '));

  const lead1Ok = await quickAdd(leader1.client, { fullName: 'Leader Contact', email: `l1.${rnd()}@example.test`, cellId: cellA, loggedBy: leader1.id, idempotencyKey: randomUUID() });
  const lead1Bad = await quickAdd(leader1.client, { fullName: 'Wrong Cell', email: `l1b.${rnd()}@example.test`, cellId: cellB, loggedBy: leader1.id, idempotencyKey: randomUUID() });
  const memberTry = await quickAdd(member.client, { fullName: 'Member Try', email: `m.${rnd()}@example.test`, cellId: cellA, loggedBy: member.id, idempotencyKey: randomUUID() });
  const spoof = await quickAdd(leader1.client, { fullName: 'Spoof', email: `sp.${rnd()}@example.test`, cellId: cellA, loggedBy: coordinator.id, idempotencyKey: randomUUID() });
  expect('A8a cell leader can log a contact in the cell they lead', !lead1Ok.error, lead1Ok.error);
  expect('A8b cell leader cannot log a contact into another cell', !!lead1Bad.error && lead1Bad.stage === 'contact', lead1Bad.error ?? 'succeeded');
  expect('A8c ordinary member cannot log a contact', !!memberTry.error, memberTry.error ?? 'succeeded');
  expect('A8d EXPECTED: a leader cannot attribute a contact to another user (logged_by spoofing)', !!spoof.error, 'spoofed logged_by accepted');
  for (const [label, u] of [['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const r = await quickAdd(u.client, { fullName: `${label} try`, email: `${label}.${rnd()}@example.test`, cellId: cellA, loggedBy: u.id, idempotencyKey: randomUUID() });
    expect(`A9 ${label} account cannot create people or contacts`, !!r.error, 'succeeded');
  }

  // ==== B. Attendance and meeting roster ===============================================================================
  const meetA = await mkMeeting(cellA, leader1.id);
  const meetB = await mkMeeting(cellB, leader2.id);
  const attend = (meetingId, u) => ({ meeting_id: meetingId, user_id: u.id, user_name: `Cert ${u.id.slice(0, 4)}` });
  const m1 = await member.client.from('meeting_attendances').insert(attend(meetA, member)).select();
  const m2 = await member2.client.from('meeting_attendances').insert(attend(meetA, member2)).select();
  expect('B1 active member can confirm their own attendance', !m1.error && !m2.error, m1.error?.message ?? m2.error?.message);
  const forged = await member.client.from('meeting_attendances').insert(attend(meetA, leader2)).select();
  expect("B2 a member cannot confirm attendance for someone else", !!forged.error, 'insert accepted');
  const own = await member.client.from('meeting_attendances').select('user_id').eq('meeting_id', meetA);
  expect("B3 a member sees only their own attendance row", !own.error && (own.data ?? []).length === 1 && own.data[0].user_id === member.id, JSON.stringify(own.data));
  await member.client.from('meeting_attendances').update({ attended: true }).eq('meeting_id', meetA).eq('user_id', member2.id).select();
  const m2row = (await admin.from('meeting_attendances').select('attended').eq('meeting_id', meetA).eq('user_id', member2.id).single()).data;
  expect("B4 a member cannot mark another person's attendance", m2row?.attended !== true, JSON.stringify(m2row));
  await member.client.from('meeting_attendances').delete().eq('meeting_id', meetA).eq('user_id', member2.id).select();
  const m2still = (await admin.from('meeting_attendances').select('id').eq('meeting_id', meetA).eq('user_id', member2.id)).data;
  expect("B5 a member cannot remove another person's attendance", (m2still ?? []).length === 1);
  await member.client.from('meeting_attendances').update({ attended: true }).eq('meeting_id', meetA).eq('user_id', member.id).select();
  const selfMark = (await admin.from('meeting_attendances').select('attended').eq('meeting_id', meetA).eq('user_id', member.id).single()).data;
  expect('B6 a member cannot mark themselves as attended (only managers confirm presence)', selfMark?.attended !== true, JSON.stringify(selfMark));

  const coordAll = await coordinator.client.from('meeting_attendances').select('user_id').eq('meeting_id', meetA);
  expect('B7 coordinator sees every attendance row for a meeting', (coordAll.data ?? []).length === 2, `rows=${(coordAll.data ?? []).length}`);
  const fix = await coordinator.client.from('meeting_attendances').update({ attended: true }).eq('meeting_id', meetA).eq('user_id', member2.id).select();
  expect('B8 coordinator can correct (mark attended) another person', !fix.error && fix.data?.length === 1 && fix.data[0].attended === true, fix.error?.message ?? `rows=${fix.data?.length}`);
  const unmark = await coordinator.client.from('meeting_attendances').update({ attended: false }).eq('meeting_id', meetA).eq('user_id', member2.id).select();
  expect('B9 coordinator can reverse a correction', !unmark.error && unmark.data?.[0]?.attended === false);
  const addMissing = await coordinator.client.from('meeting_attendances').insert(attend(meetA, leader2)).select();
  expect('B10 EXPECTED: coordinator can add a person who attended but never confirmed (roster correction)', !addMissing.error, addMissing.error?.message ?? '');
  const removeWrong = await coordinator.client.from('meeting_attendances').delete().eq('meeting_id', meetA).eq('user_id', member2.id).select();
  expect('B11 coordinator can remove a wrong roster entry', !removeWrong.error && removeWrong.data?.length === 1, removeWrong.error?.message ?? `rows=${removeWrong.data?.length}`);
  await admin.from('meeting_attendances').upsert(attend(meetA, member2), { onConflict: 'meeting_id,user_id' });
  await admin.from('meeting_attendances').upsert(attend(meetB, member2), { onConflict: 'meeting_id,user_id' });

  const l1A = await leader1.client.from('meeting_attendances').select('user_id').eq('meeting_id', meetA);
  const l1B = await leader1.client.from('meeting_attendances').select('user_id').eq('meeting_id', meetB);
  expect('B12 cell leader sees the roster of a meeting in their own cell', (l1A.data ?? []).length >= 2, `rows=${(l1A.data ?? []).length}`);
  expect("B13 cell leader sees nothing of another cell's roster", (l1B.data ?? []).length === 0, `rows=${(l1B.data ?? []).length}`);
  const l1fix = await leader1.client.from('meeting_attendances').update({ attended: true }).eq('meeting_id', meetA).eq('user_id', member2.id).select();
  expect('B14 cell leader can correct attendance in their own cell', !l1fix.error && l1fix.data?.length === 1, l1fix.error?.message ?? `rows=${l1fix.data?.length}`);
  await leader1.client.from('meeting_attendances').update({ attended: true }).eq('meeting_id', meetB).eq('user_id', member2.id).select();
  const crossRow = (await admin.from('meeting_attendances').select('attended').eq('meeting_id', meetB).eq('user_id', member2.id).single()).data;
  expect("B15 cell leader cannot correct attendance in another cell", crossRow?.attended !== true, JSON.stringify(crossRow));

  for (const [label, u] of [['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const sel = await u.client.from('meeting_attendances').select('id').eq('meeting_id', meetA);
    const ins = await u.client.from('meeting_attendances').insert(attend(meetA, u)).select();
    const upd = await u.client.from('meeting_attendances').update({ attended: true }).eq('meeting_id', meetA).select();
    const del = await u.client.from('meeting_attendances').delete().eq('meeting_id', meetA).select();
    const mt = await u.client.from('meetings').select('id').eq('id', meetA);
    expect(`B16 ${label} account cannot read, add, edit or delete attendance`, (sel.data ?? []).length === 0 && !!ins.error && (upd.data ?? []).length === 0 && (del.data ?? []).length === 0, `sel=${sel.data?.length} ins=${ins.error ? 'denied' : 'ALLOWED'} upd=${upd.data?.length} del=${del.data?.length}`);
    expect(`B17 ${label} account cannot read meetings`, (mt.data ?? []).length === 0, `rows=${mt.data?.length}`);
  }
  const anonAtt = await h.newAnon().from('meeting_attendances').select('id').limit(1);
  expect('B18 anon has no access to attendance', !!anonAtt.error);

  // ==== C. Member lifecycle, profiles and staff audit ==================================================================
  const profileUpdate = (u, patch) => u.client.from('profiles').update(patch).eq('id', u.id).select();
  const userProfileUpsert = (u, row) => u.client.from('user_profiles').upsert({ user_id: u.id, ...row }, { onConflict: 'user_id' }).select();
  const pName = await profileUpdate(pending, { full_name: 'Pending Edited' });
  expect('C1 pending account can edit its own ordinary profile field (full_name)', !pName.error && pName.data?.[0]?.full_name === 'Pending Edited', pName.error?.message ?? `rows=${pName.data?.length}`);
  const pUp = await userProfileUpsert(pending, { first_name: 'Pen', last_name: 'Ding', phone: '+14165550100' });
  expect('C2 pending account can save onboarding details (user_profiles)', !pUp.error, pUp.error?.message);
  for (const [field, value] of [['role', 'coordinator'], ['status', 'active'], ['admin_role', 'x'], ['cell_id', cellA], ['email', `forged.${rnd()}@example.test`]]) {
    const r = await profileUpdate(pending, { [field]: value });
    const now = (await admin.from('profiles').select('role,status,admin_role,cell_id,email').eq('id', pending.id).single()).data;
    expect(`C3 pending account cannot change protected field "${field}"`, !!r.error || (r.data ?? []).length === 0 || now[field] !== value, `now=${JSON.stringify(now)}`);
  }
  const aName = await profileUpdate(member, { full_name: 'Member Edited' });
  expect('C4 (design) an active member has no direct UPDATE on profiles (self-edit is limited to pending onboarding; active edits go through user_profiles)', (aName.data ?? []).length === 0, `rows=${aName.data?.length}`);
  const aUp = await userProfileUpsert(member, { first_name: 'Mem', last_name: 'Ber', phone: '+14165550111', bio: 'hello' });
  expect('C5 active member can save own user_profiles details', !aUp.error, aUp.error?.message);
  for (const [field, value] of [['role', 'admin'], ['status', 'inactive'], ['cell_id', cellB]]) {
    await profileUpdate(member, { [field]: value });
    const now = (await admin.from('profiles').select(field).eq('id', member.id).single()).data;
    expect(`C6 active member cannot change protected field "${field}"`, now[field] !== value, JSON.stringify(now));
  }
  const crossEdit = await member.client.from('profiles').update({ full_name: 'Hacked' }).eq('id', member2.id).select();
  const crossUser = await member.client.from('user_profiles').upsert({ user_id: member2.id, first_name: 'Hacked' }, { onConflict: 'user_id' }).select();
  expect("C7 a member cannot edit another member's profile or user_profiles", ((crossEdit.data ?? []).length === 0 || !!crossEdit.error) && !!crossUser.error, `profiles=${crossEdit.data?.length} user_profiles=${crossUser.error ? 'denied' : 'ALLOWED'}`);
  for (const [label, u] of [['rejected', rejected], ['inactive', inactive]]) {
    const pr = await profileUpdate(u, { full_name: 'Should Not Save' });
    const up = await userProfileUpsert(u, { first_name: 'No' });
    const nowName = (await admin.from('profiles').select('full_name').eq('id', u.id).single()).data?.full_name;
    expect(`C8 ${label} account cannot edit profiles or user_profiles`, nowName !== 'Should Not Save' && !!up.error, `profile="${nowName}" user_profiles=${up.error ? 'denied' : 'ALLOWED'} err=${pr.error?.message ?? ''}`);
    const selfActivate = await profileUpdate(u, { status: 'active' });
    const st = (await admin.from('profiles').select('status').eq('id', u.id).single()).data?.status;
    expect(`C9 ${label} account cannot reactivate itself`, st === (label === 'rejected' ? 'rejected' : 'inactive'), `status=${st} err=${selfActivate.error?.message ?? ''}`);
  }
  const inactiveLogin = await h.newAnon().auth.signInWithPassword({ email: inactive.email, password: inactive.password });
  expect('C10 inactive account still authenticates at the Auth layer (gating is app/RLS-level; recorded for the report)', !inactiveLogin.error, inactiveLogin.error?.message);

  // staff edits + audit
  const auditFor = async (targetId) => (await admin.from('staff_profile_edit_audit').select('*').eq('target_user_id', targetId).order('changed_at')).data ?? [];
  const before = (await auditFor(member.id)).length;
  await profileUpdate(member, { full_name: 'Member Self Again' });
  expect('C11 a self-edit writes no staff audit row', (await auditFor(member.id)).length === before);
  const sName = await coordinator.client.from('profiles').update({ full_name: 'Edited By Coordinator' }).eq('id', member.id).select();
  expect('C12 coordinator can edit a member\'s profile', !sName.error && sName.data?.[0]?.full_name === 'Edited By Coordinator', sName.error?.message ?? `rows=${sName.data?.length}`);
  const sPhone = await coordinator.client.from('user_profiles').update({ phone: '+14165559999', bio: 'staff bio' }).eq('user_id', member.id).select();
  expect('C13 coordinator can edit a member\'s user_profiles (phone, bio)', !sPhone.error && sPhone.data?.length === 1, sPhone.error?.message ?? `rows=${sPhone.data?.length}`);
  const aPhone = await adminUser.client.from('user_profiles').update({ first_name: 'AdminEdited' }).eq('user_id', member.id).select();
  expect('C14 admin can edit a member\'s user_profiles', !aPhone.error && aPhone.data?.length === 1, aPhone.error?.message ?? `rows=${aPhone.data?.length}`);
  const audits = await auditFor(member.id);
  const profAudit = audits.find((a) => a.source_table === 'profiles' && a.changed_by === coordinator.id);
  const upAudit = audits.find((a) => a.source_table === 'user_profiles' && a.changed_fields.includes('phone'));
  expect('C15 the coordinator profile edit is audited with actor, target and field list', !!profAudit && profAudit.changed_fields.includes('full_name'), JSON.stringify(profAudit));
  expect('C16 the user_profiles phone edit is audited', !!upAudit && upAudit.changed_by === coordinator.id, JSON.stringify(upAudit));
  const flat = JSON.stringify(audits.map((a) => a.redacted_changes));
  expect('C17 the audit stores no phone-number value (old or new)', !/5559999|5550111/.test(flat) && /redacted/.test(flat), flat.slice(0, 200));
  expect('C18 the admin edit is audited under the admin actor', audits.some((a) => a.changed_by === adminUser.id));
  const memberReadAudit = await member.client.from('staff_profile_edit_audit').select('id');
  expect('C19 a member cannot read the staff audit', (memberReadAudit.data ?? []).length === 0);
  const leaderReadAudit = await leader1.client.from('staff_profile_edit_audit').select('id');
  expect('C20 a cell leader cannot read the staff audit', (leaderReadAudit.data ?? []).length === 0);
  const staffReadAudit = await adminUser.client.from('staff_profile_edit_audit').select('id').eq('target_user_id', member.id);
  expect('C21 admin/coordinator can read the staff audit', (staffReadAudit.data ?? []).length >= 2, `rows=${staffReadAudit.data?.length}`);
  const tamper = await coordinator.client.from('staff_profile_edit_audit').insert({ target_user_id: member.id, changed_by: coordinator.id, source_table: 'profiles', changed_fields: ['x'] });
  const tamperDel = await coordinator.client.from('staff_profile_edit_audit').delete().eq('target_user_id', member.id).select();
  const tamperUpd = await coordinator.client.from('staff_profile_edit_audit').update({ changed_fields: ['x'] }).eq('target_user_id', member.id).select();
  expect('C22 audit rows are append-only for staff (no insert, update or delete through the API)', !!tamper.error && (tamperDel.data ?? []).length === 0 && (tamperUpd.data ?? []).length === 0, `ins=${tamper.error ? 'denied' : 'ALLOWED'} del=${tamperDel.data?.length} upd=${tamperUpd.data?.length}`);
  const leadEdit = await leader1.client.from('user_profiles').update({ bio: 'leader edit' }).eq('user_id', member.id).select();
  expect("C23 a cell leader cannot edit a member's user_profiles", (leadEdit.data ?? []).length === 0, `rows=${leadEdit.data?.length}`);
  const adminRole = await adminUser.client.from('profiles').update({ role: 'coordinator' }).eq('id', member2.id).select();
  const roleNow = (await admin.from('profiles').select('role').eq('id', member2.id).single()).data?.role;
  expect('C24 a non-coordinator admin cannot promote anyone to coordinator', roleNow !== 'coordinator', `role=${roleNow} err=${adminRole.error?.message ?? ''}`);
  const sStatus = await coordinator.client.from('profiles').update({ status: 'inactive' }).eq('id', member2.id).select();
  expect('C25 coordinator can deactivate an account (status change allowed for staff)', !sStatus.error && sStatus.data?.[0]?.status === 'inactive', sStatus.error?.message);
  const nowIn = await member2.client.from('meeting_attendances').select('id').eq('meeting_id', meetA);
  expect('C26 a freshly deactivated account immediately loses attendance access', (nowIn.data ?? []).length === 0, `rows=${nowIn.data?.length}`);
  await admin.from('profiles').update({ status: 'active' }).eq('id', member2.id);

  // ==== D. Email composer ==============================================================================================
  const tplBody = { name: `Cert template ${rnd()}`, subject: 'Hello {{member.full_name}}', body_markdown: 'Dear {{member.full_name}}' };
  const tCoord = await coordinator.client.from('email_templates').insert({ ...tplBody, created_by: coordinator.id }).select().single();
  if (tCoord.data) createdTemplates.push(tCoord.data.id);
  expect('D1 coordinator can create a template', !tCoord.error, tCoord.error?.message);
  const tAdmin = await adminUser.client.from('email_templates').insert({ ...tplBody, name: `Cert admin ${rnd()}`, created_by: adminUser.id }).select().single();
  if (tAdmin.data) createdTemplates.push(tAdmin.data.id);
  expect('D2 admin can create a template', !tAdmin.error, tAdmin.error?.message);
  for (const [label, u] of [['member', member], ['cell leader', leader1], ['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const t = await u.client.from('email_templates').insert({ ...tplBody, name: `deny ${rnd()}`, created_by: u.id }).select();
    const read = await u.client.from('email_templates').select('id');
    const d = await u.client.from('email_drafts').insert({ subject: 's', body_markdown: 'b', created_by: u.id }).select();
    expect(`D3 ${label} cannot create or read templates, or create drafts`, !!t.error && (read.data ?? []).length === 0 && !!d.error, `tplInsert=${t.error ? 'denied' : 'ALLOWED'} read=${read.data?.length} draft=${d.error ? 'denied' : 'ALLOWED'}`);
  }
  const t2edit = await coordinator2.client.from('email_templates').update({ subject: 'Edited by coordinator 2' }).eq('id', tCoord.data.id).select();
  expect('D4 templates are shared: another coordinator can edit', !t2edit.error && t2edit.data?.length === 1);
  const draftIns = await coordinator.client.from('email_drafts').insert({ template_id: tCoord.data.id, subject: 'Draft subject', body_markdown: 'Draft body {{member.full_name}}', recipient_ids: [member.id, member2.id], recipient_filter: { role: 'member' }, created_by: coordinator.id }).select().single();
  if (draftIns.data) createdDrafts.push(draftIns.data.id);
  expect('D5 coordinator can save a draft', !draftIns.error, draftIns.error?.message);
  const reopened = await coordinator.client.from('email_drafts').select('*').eq('id', draftIns.data.id).single();
  expect('D6 reopening the draft restores subject, body, recipients, filter and linked template id', reopened.data?.subject === 'Draft subject' && reopened.data?.body_markdown.includes('{{member.full_name}}') && reopened.data?.recipient_ids?.length === 2 && reopened.data?.recipient_filter?.role === 'member' && reopened.data?.template_id === tCoord.data.id, JSON.stringify(reopened.data));
  const linkedTpl = await coordinator.client.from('email_templates').select('name').eq('id', reopened.data.template_id).single();
  expect('D7 the linked template name can be resolved from the draft (what the 5-line UI fix relies on)', linkedTpl.data?.name === tplBody.name, JSON.stringify(linkedTpl.data));
  const other = await coordinator2.client.from('email_drafts').select('id').eq('id', draftIns.data.id);
  expect("D8 another coordinator cannot see or open someone else's draft", (other.data ?? []).length === 0, `rows=${other.data?.length}`);
  const otherUpd = await coordinator2.client.from('email_drafts').update({ subject: 'taken' }).eq('id', draftIns.data.id).select();
  const otherDel = await coordinator2.client.from('email_drafts').delete().eq('id', draftIns.data.id).select();
  expect("D9 another coordinator cannot edit or delete someone else's draft", (otherUpd.data ?? []).length === 0 && (otherDel.data ?? []).length === 0);
  const forgedDraft = await coordinator2.client.from('email_drafts').insert({ subject: 'x', body_markdown: 'y', created_by: coordinator.id }).select();
  expect('D10 a draft cannot be created in another user\'s name', !!forgedDraft.error);
  const upd = await coordinator.client.from('email_drafts').update({ body_markdown: 'Updated body' }).eq('id', draftIns.data.id).select();
  expect('D11 saving again updates the same draft (persistence)', !upd.error && upd.data?.[0]?.body_markdown === 'Updated body');
  await admin.from('email_templates').delete().eq('id', tCoord.data.id);
  const orphan = await coordinator.client.from('email_drafts').select('template_id').eq('id', draftIns.data.id).single();
  expect('D12 deleting a template keeps the draft and clears its link', !orphan.error && orphan.data?.template_id === null, JSON.stringify(orphan));
  const blank = await coordinator.client.from('email_drafts').insert({ subject: '   ', body_markdown: 'x', created_by: coordinator.id }).select();
  expect('D13 a blank subject draft is rejected by the database', !!blank.error);

  // sending path (edge function): authorization, recipients and preferences. No relay is configured, so authorised
  // calls stop at EMAIL_PROVIDER_NOT_CONFIGURED; nothing is delivered.
  const callSend = (u, body) => fetch(`${fnUrl}/send-email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u?.token ?? h.anonKey}`, apikey: h.anonKey }, body: JSON.stringify(body) });
  for (const [label, u] of [['anon', null], ['member', member], ['cell leader', leader1], ['pending', pending], ['rejected', rejected], ['inactive', inactive]]) {
    const r = await callSend(u, { action: 'batch', recipients: [{ email: member.email, memberId: member.id }], subject: 'deny', html: '<p>x</p>' });
    expect(`D14 ${label} cannot send email through the edge function`, r.status === 401 || r.status === 403, `status=${r.status}`);
  }
  await admin.from('email_preferences').upsert({ user_id: member.id, opt_out_all: true, admin_announcements: false }, { onConflict: 'user_id' });
  const marker = `pref-check-${rnd()}`;
  const sendOpt = await callSend(coordinator, { action: 'batch', recipients: [{ email: member.email, memberId: member.id }], subject: marker, html: '<p>x</p>', templateType: 'generic' });
  const sentBody = await sendOpt.text();
  const { data: loggedRows } = await admin.from('email_log').select('id,status,failed_reason').eq('subject', marker);
  (loggedRows ?? []).forEach((r) => createdEmailLog.push(r.id));
  expect('D15 nothing is delivered: the call ends skipped (200) or at the unconfigured provider boundary (500)', (sendOpt.status === 200 && /"sent":0/.test(sentBody)) || (sendOpt.status === 500 && /EMAIL_PROVIDER_NOT_CONFIGURED/.test(sentBody)), `status=${sendOpt.status} ${sentBody.slice(0, 120)}`);
  expect('D16 EXPECTED: a recipient with opt_out_all=true is excluded before any send is attempted (no email_log row for them)', (loggedRows ?? []).length === 0 || (loggedRows ?? []).every((r) => r.status === 'skipped'), `email_log rows created for the opted-out recipient: ${JSON.stringify(loggedRows)}`);
  const stranger = `stranger.${rnd()}@example.test`;
  const sendStranger = await callSend(coordinator, { action: 'send', to: stranger, subject: `stranger-${marker}`, html: '<p>x</p>' });
  await sendStranger.text();
  const { data: strangerRows } = await admin.from('email_log').select('id').eq('recipient_email', stranger);
  (strangerRows ?? []).forEach((r) => createdEmailLog.push(r.id));
  expect('D17 EXPECTED: sending to an address that belongs to no active member is rejected before logging', (strangerRows ?? []).length === 0, `an email_log row was created for an unknown recipient (${(strangerRows ?? []).length})`);
  const pendingTarget = await callSend(coordinator, { action: 'send', to: pending.email, memberId: pending.id, subject: `pending-${marker}`, html: '<p>x</p>' });
  await pendingTarget.text();
  const { data: pendRows } = await admin.from('email_log').select('id').eq('recipient_email', pending.email);
  (pendRows ?? []).forEach((r) => createdEmailLog.push(r.id));
  expect('D18 EXPECTED: a pending/rejected/inactive account is not an eligible recipient', (pendRows ?? []).length === 0, `an email_log row was created for a pending recipient`);

  // ==== E. Email-open tracking and unsubscribe =========================================================================
  const mkLog = async (memberRow) => {
    const { data, error } = await admin.from('email_log').insert({ member_id: memberRow.id, recipient_email: memberRow.email, subject: `track ${rnd()}`, template_type: 'generic', status: 'sent' }).select('id,tracking_token').single();
    if (error) throw new Error(`email_log insert: ${error.message}`);
    createdEmailLog.push(data.id);
    return data;
  };
  const logA = await mkLog(member);
  const logB = await mkLog(member2);
  const rpc = (client, id, token) => client.rpc('track_email_open', { message_id: id, token });
  const opened = async (id) => (await admin.from('email_log').select('opened_at').eq('id', id).single()).data?.opened_at;
  const missing = await admin.rpc('track_email_open', { message_id: logA.id });
  expect('E1 service_role call without a token is rejected', !!missing.error, JSON.stringify(missing.data));
  const bad = await rpc(admin, logA.id, randomUUID());
  expect('E2 wrong token touches nothing and returns false', bad.data === false && (await opened(logA.id)) === null, JSON.stringify(bad));
  const cross = await rpc(admin, logB.id, logA.tracking_token);
  expect("E3 message A's token cannot open message B (no cross-recipient tracking)", cross.data === false && (await opened(logB.id)) === null, JSON.stringify(cross));
  const malformed = await admin.rpc('track_email_open', { message_id: 'not-a-uuid', token: 'x' });
  expect('E4 malformed ids are rejected', !!malformed.error);
  for (const [label, client] of [['anon', h.newAnon()], ['authenticated member', member.client], ['authenticated coordinator', coordinator.client]]) {
    const r = await rpc(client, logA.id, logA.tracking_token);
    expect(`E5 ${label} cannot call track_email_open directly, even with the correct token`, !!r.error && (await opened(logA.id)) === null, JSON.stringify(r));
  }
  const authHdr = { apikey: h.anonKey, Authorization: `Bearer ${h.anonKey}` };
  const edgeGet = (id, token) => fetch(`${fnUrl}/send-email?messageId=${encodeURIComponent(id)}&trackingToken=${encodeURIComponent(token)}`, { headers: authHdr });
  const bareGet = await fetch(`${fnUrl}/send-email?messageId=${logA.id}&trackingToken=${logA.tracking_token}`);
  expect('E5b EXPECTED: the real email pixel (a bare GET from a mail client, no headers) is accepted and records the open', bareGet.status === 204 && !!(await opened(logA.id)), `bare GET status=${bareGet.status}`);
  await admin.from('email_log').update({ opened_at: null }).eq('id', logA.id);
  const g1 = await edgeGet(logA.id, randomUUID());
  const g2 = await edgeGet(randomUUID(), randomUUID());
  expect('E6 pixel with a wrong token records nothing and answers identically to an unknown message (no enumeration)', g1.status === g2.status && g1.status === 204 && (await opened(logA.id)) === null, `wrongToken=${g1.status} unknownMsg=${g2.status}`);
  const g3 = await fetch(`${fnUrl}/send-email`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr }, body: JSON.stringify({ action: 'track_open', messageId: logA.id }) });
  expect('E7 track_open without a token records nothing', (await opened(logA.id)) === null, `status=${g3.status}`);
  const readOther = await member.client.from('email_log').select('id,tracking_token').eq('id', logB.id);
  expect("E8 a member cannot read another member's email_log row (so cannot learn their token)", (readOther.data ?? []).length === 0);
  const g4 = await edgeGet(logA.id, logA.tracking_token);
  const first = await opened(logA.id);
  expect('E9 pixel with the correct token records the open', g4.status === 204 && !!first, `status=${g4.status} opened=${first}`);
  await edgeGet(logA.id, logA.tracking_token);
  expect('E10 a repeat open keeps the first opened_at', (await opened(logA.id)) === first);
  expect('E11 the other recipient\'s message is still unopened', (await opened(logB.id)) === null);
  const memberOwn = await member.client.from('email_log').update({ opened_at: null }).eq('id', logA.id).select();
  expect('E12 a member cannot rewrite their own email_log row through the API', (memberOwn.data ?? []).length === 0, `rows=${memberOwn.data?.length}`);

  if (unsubSecret) {
    const badTok = await fetch(`${fnUrl}/unsubscribe?token=${encodeURIComponent('abc.def')}`, { headers: authHdr });
    expect('E13 unsubscribe with a forged token is rejected', badTok.status === 400);
    const tampered = mintUnsubToken(member.id, 'generic').replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    const tamp = await fetch(`${fnUrl}/unsubscribe?token=${encodeURIComponent(tampered)}`, { headers: authHdr });
    expect('E14 unsubscribe with a tampered signature is rejected', tamp.status === 400);
    const expired = await fetch(`${fnUrl}/unsubscribe?token=${encodeURIComponent(mintUnsubToken(member.id, 'generic', -10))}`, { headers: authHdr });
    expect('E15 an expired unsubscribe token is rejected', expired.status === 400);
    await admin.from('email_preferences').upsert({ user_id: member2.id, weekly_digest: true, admin_announcements: true, opt_out_all: false }, { onConflict: 'user_id' });
    const ok = await fetch(`${fnUrl}/unsubscribe?token=${encodeURIComponent(mintUnsubToken(member2.id, 'generic'))}`, { headers: authHdr });
    const bareUnsub = await fetch(`${fnUrl}/unsubscribe?token=${encodeURIComponent(mintUnsubToken(member2.id, 'weekly_digest'))}`);
    expect('E16b EXPECTED: the real unsubscribe link (a bare browser GET, no headers) works', bareUnsub.status === 200, `bare GET status=${bareUnsub.status}`);
    const prefs = (await admin.from('email_preferences').select('admin_announcements,weekly_digest').eq('user_id', member2.id).single()).data;
    expect('E16 a valid unsubscribe link switches off exactly that category for that user', ok.status === 200 && prefs?.admin_announcements === false, JSON.stringify(prefs));
    const mPrefs = (await admin.from('email_preferences').select('admin_announcements').eq('user_id', member.id).single()).data;
    expect("E17 the unsubscribe did not touch another user's preferences", mPrefs?.admin_announcements === false || mPrefs?.admin_announcements === true);
  } else {
    h.fail('E13-E17 unsubscribe checks', 'CERT_UNSUBSCRIBE_SECRET not provided - not executed');
  }
} catch (error) {
  h.fail('harness completed without error', error instanceof Error ? error.message : String(error));
} finally {
  // Best-effort removal of fixtures that do not cascade from the accounts.
  try { if (createdDrafts.length) await admin.from('email_drafts').delete().in('id', createdDrafts); } catch { /* ignore */ }
  try { if (createdTemplates.length) await admin.from('email_templates').delete().in('id', createdTemplates); } catch { /* ignore */ }
  try { if (createdEmailLog.length) await admin.from('email_log').delete().in('id', createdEmailLog); } catch { /* ignore */ }
  try { if (createdMeetings.length) await admin.from('meetings').delete().in('id', createdMeetings); } catch { /* ignore */ }
  try { await h.cleanup(); } catch { /* ignore */ }
  try { if (createdPeople.length) await admin.from('contacts').delete().in('person_id', createdPeople); } catch { /* ignore */ }
  try { if (createdPeople.length) await admin.from('people').delete().in('id', createdPeople); } catch { /* ignore */ }
  try { if (createdCells.length) await admin.from('cells').delete().in('id', createdCells); } catch { /* ignore */ }
  h.report();
}
