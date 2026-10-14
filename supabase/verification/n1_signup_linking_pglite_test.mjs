// N1 signup identity linking, after migration 099, on a DISPOSABLE in-process PGlite replay of 000-099.
// No Docker, no network, no hosted database. Fake accounts only (.invalid). Exit 1 on any failed expectation.
//
// Run:  PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/n1_signup_linking_pglite_test.mjs
//
// Limits: PGlite is not a Supabase stack. auth.users is the shim's table, with email_confirmed_at added here the way GoTrue
// records it. The trigger wiring is the replayed 000 trigger. Production's enable_confirmations value is NOT tested.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', 'migrations'));
await db.exec(`alter table auth.users add column if not exists email_confirmed_at timestamptz`);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};
const as = (role, uid, sql, params = []) => attempt(db, role, uid, sql, params);
const scalar = async (role, uid, sql, params = []) => {
  const r = await as(role, uid, sql, params);
  return r.ok ? r.rows[0] : { error: r.error, code: r.code };
};
const count = async (role, uid, sql, params = []) => {
  const r = await as(role, uid, `select count(*)::int n from (${sql}) x`, params);
  return r.ok ? r.rows[0].n : `ERR ${r.error}`;
};

const ID = {
  admin: 'b0000000-0000-4000-8000-000000000001',
  member: 'b0000000-0000-4000-8000-000000000002',
  impostor: 'b0000000-0000-4000-8000-0000000000b1',
  verifiedMatch: 'b0000000-0000-4000-8000-0000000000c1',
  newApplicant: 'b0000000-0000-4000-8000-0000000000d1',
  rejected: 'b0000000-0000-4000-8000-0000000000e1',
  pendingReject: 'b0000000-0000-4000-8000-0000000000f1',
};
const PROSPECT_EMAIL = 'prospect.n1@probe.invalid';
const NEW_EMAIL = 'newapplicant.n1@probe.invalid';
const REASON = 'Verified the applicant at the desk, matched prospect record';

// Owner-side fixtures. Each auth insert runs the real signup trigger (000 -> handle_new_user).
await db.exec(`
  insert into public.people (full_name, email) values ('Prospect Person', '${PROSPECT_EMAIL}');
`);
const prospectId = (await db.query(`select id from public.people where email = '${PROSPECT_EMAIL}'`)).rows[0].id;

const signup = (id, email, confirmed, name) =>
  db.query(
    `insert into auth.users (id, email, aud, role, created_at, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, 'authenticated', 'authenticated', now(), $3, jsonb_build_object('full_name', $4::text))`,
    [id, email, confirmed ? new Date().toISOString() : null, name],
  );

// Staff and an ordinary member, made active through the owner (as the workflow would).
await signup(ID.admin, 'admin.n1@probe.invalid', true, 'Admin N1');
await signup(ID.member, 'member.n1@probe.invalid', true, 'Member N1');
await db.exec(`update public.profiles set status = 'active', role = 'admin' where id = '${ID.admin}'`);
await db.exec(`update public.profiles set status = 'active', role = 'member' where id = '${ID.member}'`);

const peopleCountFor = async (email) =>
  (await db.query(`select count(*)::int n from public.people where public.normalize_identity_email(email) = public.normalize_identity_email($1)`, [email])).rows[0].n;
const profileOf = async (id) =>
  (await db.query(`select status, person_id from public.profiles where id = $1`, [id])).rows[0];

// ── 1. Signup with an existing prospect's email does not link, verified or not.
await signup(ID.impostor, PROSPECT_EMAIL, false, 'Impostor');
const imp = await profileOf(ID.impostor);
check('1a unverified signup with a prospect email: profile pending', imp?.status === 'pending', `status=${imp?.status}`);
check('1b unverified signup with a prospect email: NOT linked', imp?.person_id === null, `person_id=${imp?.person_id}`);
check('1c no duplicate people row for the prospect email', (await peopleCountFor(PROSPECT_EMAIL)) === 1);

await signup(ID.verifiedMatch, PROSPECT_EMAIL.replace('prospect', 'prospect2'), true, 'Verified Match'); // different email: control
const vm0 = await profileOf(ID.verifiedMatch);
check('1d control: verified signup with a NEW email creates a linked person', vm0?.person_id !== null, `person_id=${vm0?.person_id}`);

// Verified signup with the prospect's exact email: still not linked, even though it is confirmed (verification alone is not ownership of a person).
await db.exec(`delete from auth.users where id = '${ID.verifiedMatch}'`);
await db.exec(`delete from public.profiles where id = '${ID.verifiedMatch}'`);
await db.exec(`delete from public.people where email = '${PROSPECT_EMAIL.replace('prospect', 'prospect2')}'`);
await signup(ID.verifiedMatch, PROSPECT_EMAIL, true, 'Verified Match');
const vm = await profileOf(ID.verifiedMatch);
check('1e verified signup with a prospect email: NOT linked', vm?.person_id === null, `person_id=${vm?.person_id}`);
check('1f still exactly one people row for the prospect email', (await peopleCountFor(PROSPECT_EMAIL)) === 1);

// ── 2. The prospect stays visible to ordinary members; the unlinked impostor cannot read the prospect.
check('2a active member reads the prospect (not hidden by an unlinked signup)',
  (await count('authenticated', ID.member, `select 1 from public.people where id = '${prospectId}'`)) === 1);
check('2b unlinked, pending impostor reads no prospect row (name, email or phone)',
  (await count('authenticated', ID.impostor, `select 1 from public.people where id = '${prospectId}'`)) === 0);

// New-email signup still registers as before.
await signup(ID.newApplicant, NEW_EMAIL, true, 'New Applicant');
const na = await profileOf(ID.newApplicant);
check('3a new-email signup: person created and linked', na?.person_id !== null);
check('3b new-email signup: profile pending', na?.status === 'pending');

// ── 4. Attach authorization. Every refusal below must leave the profile unlinked.
const linkAs = (role, uid, profileId, personId, reason) =>
  as(role, uid, `select public.link_pending_profile_to_person($1::uuid, $2::uuid, $3::text)`, [profileId, personId, reason]);

let r = await linkAs('authenticated', ID.member, ID.impostor, prospectId, REASON);
check('4a ordinary member cannot attach', !r.ok && r.code === '42501', r.error);
r = await linkAs('authenticated', ID.admin, ID.impostor, prospectId, 'no');
check('4b reason too short refused', !r.ok, r.error);
r = await linkAs('authenticated', ID.admin, ID.impostor, prospectId, REASON);
check('4c unverified account (email not confirmed) refused', !r.ok && r.code === '42501', r.error);
check('4d refused attach leaves the profile unlinked', (await profileOf(ID.impostor)).person_id === null);

await db.exec(`insert into public.people (full_name, email) values ('Orphan Person', 'orphan.n1@probe.invalid')`);
// Confirm the impostor's email as GoTrue would when they click the link. The email still does not match a different person.
await db.exec(`update auth.users set email_confirmed_at = now() where id = '${ID.impostor}'`);
r = await linkAs('authenticated', ID.admin, ID.impostor, (await scalar('owner', null, `select id from public.people where email = 'orphan.n1@probe.invalid'`)).id, REASON);
check('4e verified account attached to a DIFFERENT person refused (email mismatch)', !r.ok && r.code === '42501', r.error);

// Rejected accounts cannot claim anything.
await signup(ID.rejected, 'rejected.n1@probe.invalid', true, 'Rejected');
await db.exec(`update public.profiles set status = 'rejected' where id = '${ID.rejected}'`);
await db.exec(`update auth.users set email = '${PROSPECT_EMAIL}' where id = '${ID.rejected}'`);
r = await linkAs('authenticated', ID.admin, ID.rejected, prospectId, REASON);
check('4f rejected account cannot be attached', !r.ok && r.code === '42501', r.error);

r = await as('anon', null, `select public.link_pending_profile_to_person($1::uuid, $2::uuid, $3::text)`, [ID.impostor, prospectId, REASON]);
check('4g anonymous caller cannot call the attach RPC', !r.ok, r.error);

// ── 5. Authorized, audited attach of a verified, matching, pending account.
r = await linkAs('authenticated', ID.admin, ID.impostor, prospectId, REASON);
check('5a staff attach of a verified matching pending account succeeds', r.ok, r.error);
check('5b the profile now links to the prospect', (await profileOf(ID.impostor)).person_id === prospectId);
check('5c exactly one audit row, recording the actor and reason',
  (await count('owner', null, `select 1 from public.profile_link_audit where profile_id = '${ID.impostor}' and actor_id = '${ID.admin}' and reason = $1`, [REASON])) === 1);

r = await linkAs('authenticated', ID.admin, ID.impostor, prospectId, REASON);
check('5d a second attach of an already linked account is refused', !r.ok, r.error);

// A verified account matching the same prospect now cannot take the same person (one account per person).
await db.exec(`update auth.users set email_confirmed_at = now() where id = '${ID.verifiedMatch}'`);
r = await linkAs('authenticated', ID.admin, ID.verifiedMatch, prospectId, REASON);
check('5e a second account cannot attach to a person who already has one', !r.ok && r.code === 'P0001', r.error);

// ── 6. A pending linked account reads no person row until it is approved; after approval it reads its own only.
check('6a pending linked account reads no person row, even its own (active-only rule)',
  (await count('authenticated', ID.impostor, `select 1 from public.people where id = '${prospectId}'`)) === 0);
r = await as('authenticated', ID.admin, `select * from public.approve_pending_member($1::uuid)`, [ID.impostor]);
check('6b staff approves the attached account', r.ok && r.rows.length === 1, r.error);
check('6c approved account reads its own linked person', (await count('authenticated', ID.impostor, `select 1 from public.people where id = '${prospectId}'`)) === 1);
const newApplicantPerson = (await profileOf(ID.newApplicant)).person_id;
const nv = await count('authenticated', ID.impostor, `select 1 from public.people where id = '${newApplicantPerson}'`);
check('6d approved account cannot read the new applicant\'s person', nv === 0, `count=${nv}`);

// ── 7. Staff rejection leaves a pending account unlinked and gives it no read.
await signup(ID.pendingReject, 'pending.reject.n1@probe.invalid', false, 'Pending Reject');
r = await as('authenticated', ID.admin, `select * from public.reject_pending_member($1::uuid)`, [ID.pendingReject]);
check('7a staff rejection changes status only', r.ok && r.rows[0]?.status === 'rejected', r.error);
const rejectedOwnPerson = (await profileOf(ID.pendingReject)).person_id;
check('7b rejected account reads no person row, not even its own (active-only rule)',
  (await count('authenticated', ID.pendingReject, `select 1 from public.people where id = '${rejectedOwnPerson}'`)) === 0);

// ── 8. Audit is append-only and not client-readable or client-writable.
let u = await db.query(`update public.profile_link_audit set reason = 'x'`).then(() => 'changed', (e) => `refused: ${e.message}`);
check('8a audit rows cannot be updated, even by the owner', String(u).startsWith('refused'), String(u));
check('8b authenticated cannot read the audit table', !(await as('authenticated', ID.admin, `select 1 from public.profile_link_audit`)).ok);
check('8c authenticated cannot insert into the audit table',
  !(await as('authenticated', ID.admin, `insert into public.profile_link_audit (profile_id, person_id, actor_id, action, reason) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'attach', 'forged')`)).ok);

// ── 9. Existing link made before 099 is preserved (the impostor link above was made by staff, so this is the member's own).
const memberPerson = (await db.query(`select person_id from public.profiles where id = '${ID.member}'`)).rows[0].person_id;
check('9a an active member keeps its own linked person (no rewrite)',
  memberPerson !== null && (await count('authenticated', ID.member, `select 1 from public.people where id = '${memberPerson}'`)) === 1);

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
process.exit(failed.length ? 1 : 0);
