// Staff account linking (migration 103), on a DISPOSABLE in-process PGlite replay of 000-103.
// Adapted to the single queue RPC list_account_link_queue(p_reason) and SQLSTATE 42501 for the unlinked-approval refusal.
// No Docker, no network, no hosted database. Fake accounts only (.invalid). Exit 1 on any failed expectation.
//
// Run:  PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/staff_account_linking_pglite_test.mjs
//
// Limits: PGlite is not a Supabase stack. auth.users is the shim's table, with email_confirmed_at and email_change added
// here the way GoTrue records them. Real GoTrue behaviour, PostgREST error mapping and true concurrent sessions are NOT
// tested here. Concurrency is covered only by the unique index and the row locks, checked by sequential attempts.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', 'migrations'));
// email_confirmed_at and email_change are part of the shim since the 103 reconciliation (pglite_replay.mjs).

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};
const as = (role, uid, sql, params = []) => attempt(db, role, uid, sql, params);

const ID = {
  admin: 'c0000000-0000-4000-8000-000000000001',
  coordinator: 'c0000000-0000-4000-8000-000000000003',
  member: 'c0000000-0000-4000-8000-000000000002',
  unverifiedMatch: 'c0000000-0000-4000-8000-0000000000a1',
  verifiedMatch: 'c0000000-0000-4000-8000-0000000000b1',
  verifiedNoMatch: 'c0000000-0000-4000-8000-0000000000c1',
  newApplicant: 'c0000000-0000-4000-8000-0000000000d1',
  rejectedMatch: 'c0000000-0000-4000-8000-0000000000e1',
  emailChange: 'c0000000-0000-4000-8000-0000000000f1',
};
const PROSPECT_EMAIL = 'prospect.link103@probe.invalid';
const PROSPECT2_EMAIL = 'prospect2.link103@probe.invalid';
const NEW_EMAIL = 'newapplicant.link103@probe.invalid';
const REASON = 'Matched the applicant at the desk to the prospect record';
const NIL = '00000000-0000-0000-0000-000000000000';
const EMAIL_TEXT = [PROSPECT_EMAIL, PROSPECT2_EMAIL, NEW_EMAIL, 'verifiednomatch.link103@probe.invalid'];

await db.exec(`insert into public.people (full_name, email) values ('Prospect Person', '${PROSPECT_EMAIL}')`);
await db.exec(`insert into public.people (full_name, email) values ('Prospect Two', '${PROSPECT2_EMAIL}')`);
const prospectId = (await db.query(`select id from public.people where email = '${PROSPECT_EMAIL}'`)).rows[0].id;
const prospect2Id = (await db.query(`select id from public.people where email = '${PROSPECT2_EMAIL}'`)).rows[0].id;

const signup = (id, email, confirmed, name) =>
  db.query(
    `insert into auth.users (id, email, aud, role, created_at, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, 'authenticated', 'authenticated', now(), $3, jsonb_build_object('full_name', $4::text))`,
    [id, email, confirmed ? new Date().toISOString() : null, name],
  );
const profileOf = async (id) =>
  (await db.query(`select status, person_id, role from public.profiles where id = $1`, [id])).rows[0];

// Staff and ordinary members, made active through the owner as the approval workflow would.
await signup(ID.admin, 'admin.link103@probe.invalid', true, 'Admin Link');
await signup(ID.coordinator, 'coord.link103@probe.invalid', true, 'Coordinator Link');
await signup(ID.member, 'member.link103@probe.invalid', true, 'Member Link');
await db.exec(`update public.profiles set status = 'active', role = 'admin' where id = '${ID.admin}'`);
await db.exec(`update public.profiles set status = 'active', role = 'coordinator' where id = '${ID.coordinator}'`);
await db.exec(`update public.profiles set status = 'active', role = 'member' where id = '${ID.member}'`);

// Pending accounts. An email that matches an existing person signs up UNLINKED (099).
await signup(ID.unverifiedMatch, PROSPECT_EMAIL, false, 'Unverified Match');
await signup(ID.verifiedMatch, PROSPECT2_EMAIL, true, 'Verified Match');
await signup(ID.verifiedNoMatch, 'verifiednomatch.link103@probe.invalid', true, 'Verified New');
// A verified account with a NEW email gets its own person at signup (linked). It must not appear in the queue.
await signup(ID.newApplicant, NEW_EMAIL, true, 'New Applicant');
// Verified, linked at signup (new email), then rejected: must not appear in the queue.
await signup(ID.rejectedMatch, 'rejected.link103@probe.invalid', true, 'Rejected Match');
await db.exec(`update public.profiles set status = 'rejected' where id = '${ID.rejectedMatch}'`);
await signup(ID.emailChange, 'emailchange.link103@probe.invalid', true, 'Email Change');

const queue = (role, uid, reason = REASON) =>
  as(role, uid, `select * from public.list_account_link_queue($1::text)`, [reason]);
const auditCount = async (kind) =>
  (await db.query(`select count(*)::int n from public.identity_read_audit where target_kind = $1`, [kind])).rows[0].n;

// ── 1. Queue authorization ─────────────────────────────────────────────────────────────────────────────────────────────
let r = await queue('authenticated', ID.member);
check('1a ordinary member is refused the queue', !r.ok && r.code === '42501', r.error);
r = await queue('anon', null);
check('1b anonymous caller is refused the queue', !r.ok, r.error);
r = await as('authenticated', ID.coordinator, `select count(*)::int n from public.list_account_link_queue('x')`);
check('1c coordinator with a too-short reason is refused by the reason rule', !r.ok && r.code === '22023', r.error);
r = await queue('authenticated', ID.unverifiedMatch);
check('1d a pending, unlinked account cannot read the queue', !r.ok && r.code === '42501', r.error);

// ── 2. Queue content, exact match, and non-disclosure ─────────────────────────────────────────────────────────────────
const before = await auditCount('account_link');
r = await queue('authenticated', ID.admin);
check('2a administrator can read the queue', r.ok, r.error);
const rows = r.ok ? r.rows : [];
const byProfile = Object.fromEntries(rows.map((row) => [row.profile_id, row]));
check('2b queue returns the verified, unlinked account whose email matches a person',
  byProfile[ID.verifiedMatch]?.person_id === prospect2Id, JSON.stringify(byProfile[ID.verifiedMatch] ?? null));
check('2c matching person name is the exact match name', byProfile[ID.verifiedMatch]?.person_name === 'Prospect Two');
check('2d verified new-email account (linked at signup, 099) is excluded', !(ID.verifiedNoMatch in byProfile));
check('2e UNVERIFIED unlinked account is excluded', !(ID.unverifiedMatch in byProfile));
check('2f linked (active or new-email) accounts are excluded', !(ID.newApplicant in byProfile) && !(ID.member in byProfile));
check('2g rejected account is excluded', !(ID.rejectedMatch in byProfile));
const keys = rows.length ? Object.keys(rows[0]).sort().join(',') : '';
check('2h the queue returns exactly the five approved columns',
  keys === 'created_at,display_name,person_id,person_name,profile_id', keys);
const dump = JSON.stringify(rows);
check('2i no email address appears anywhere in the queue output', EMAIL_TEXT.every((e) => !dump.includes(e)));
check('2j display name and creation date are returned',
  byProfile[ID.verifiedMatch]?.display_name === 'Verified Match' && !!byProfile[ID.verifiedMatch]?.created_at);
check('2k queue access writes an audit row', (await auditCount('account_link')) === before + 1);
const auditRow = (await db.query(`select actor_id, target_id, reason from public.identity_read_audit where target_kind='account_link' order by id desc limit 1`)).rows[0];
check('2l audit row records the actor, the nil queue target and the reason',
  auditRow?.actor_id === ID.admin && auditRow?.target_id === NIL && auditRow?.reason === REASON.trim(), JSON.stringify(auditRow));

// Refused calls must not write audit rows.
const beforeRefused = await auditCount('account_link');
await queue('authenticated', ID.member);
check('2m a refused queue call writes no audit row', (await auditCount('account_link')) === beforeRefused);

// ── 3. Approval refused before linking ───────────────────────────────────────────────────────────────────────────────
const approve = (uid, target) => as('authenticated', uid, `select * from public.approve_pending_member($1::uuid)`, [target]);
r = await approve(ID.admin, ID.verifiedMatch);
check('3a approval refused for an UNLINKED pending account (42501, "before approving")', !r.ok && r.code === '42501' && /before approving/.test(r.error), r.error);
check('3b refused approval leaves the account pending and unlinked',
  (await profileOf(ID.verifiedMatch)).status === 'pending' && (await profileOf(ID.verifiedMatch)).person_id === null);
r = await approve(ID.member, ID.verifiedMatch);
check('3c ordinary member cannot approve', !r.ok && r.code === '42501', r.error);
r = await approve(ID.coordinator, ID.verifiedMatch);
check('3d coordinator is refused approval before linking too', !r.ok && r.code === '42501', r.error);

// ── 4. Linking refusals ───────────────────────────────────────────────────────────────────────────────────────────────
const link = (uid, profileId, personId, reason = REASON) =>
  as('authenticated', uid, `select public.link_pending_profile_to_person($1::uuid, $2::uuid, $3::text)`, [profileId, personId, reason]);

r = await link(ID.member, ID.verifiedMatch, prospect2Id);
check('4a ordinary member cannot link', !r.ok && r.code === '42501', r.error);
r = await link(ID.admin, ID.unverifiedMatch, prospectId);
check('4b unverified account cannot be linked', !r.ok && r.code === '42501', r.error);
r = await link(ID.admin, ID.verifiedMatch, prospect2Id, 'no');
check('4c reason too short is refused', !r.ok && r.code === '22023', r.error);
r = await link(ID.admin, ID.verifiedMatch, prospectId);
check('4d a verified account cannot be linked to a person with a different email', !r.ok && r.code === '42501', r.error);
r = await link(ID.admin, ID.rejectedMatch, prospect2Id);
check('4e a rejected account cannot be linked (pending only)', !r.ok && r.code === '42501', r.error);
r = await link(ID.admin, ID.newApplicant, prospectId);
check('4f an already linked account cannot be linked again', !r.ok && r.code === 'P0001', r.error);

// Pending email change refusal.
await db.exec(`update auth.users set email_change = 'changed.link103@probe.invalid' where id = '${ID.verifiedMatch}'`);
r = await link(ID.admin, ID.verifiedMatch, prospect2Id);
check('4g linking refused while the account has a pending email change', !r.ok && r.code === '42501' && /pending email change/.test(r.error), r.error);
check('4h refused pending-change link leaves the account unlinked', (await profileOf(ID.verifiedMatch)).person_id === null);
await db.exec(`update auth.users set email_change = '   ' where id = '${ID.verifiedMatch}'`);
r = await link(ID.admin, ID.verifiedMatch, prospect2Id);
check('4i whitespace-only email_change is not a pending change (link succeeds)', r.ok, r.error);
// Reset this account so the rest of the flow can use it as the pending, unlinked case.
await db.exec(`update public.profiles set person_id = null where id = '${ID.verifiedMatch}'`);
await db.exec(`update auth.users set email_change = 'changed2.link103@probe.invalid' where id = '${ID.verifiedMatch}'`);
r = await link(ID.admin, ID.verifiedMatch, prospect2Id);
check('4j pending change set again: refused (control)', !r.ok && r.code === '42501', r.error);
await db.exec(`update auth.users set email_change = null where id = '${ID.verifiedMatch}'`);

// ── 5. Authorized linking, then approval ─────────────────────────────────────────────────────────────────────────────
const profileLinkAudit = async () => (await db.query(`select count(*)::int n from public.profile_link_audit where profile_id = $1`, [ID.verifiedMatch])).rows[0].n;
const linkAuditBefore = await profileLinkAudit();
r = await link(ID.admin, ID.verifiedMatch, prospect2Id);
check('5a authorized staff link to the exact matching person succeeds', r.ok, r.error);
check('5b link writes exactly one profile_link_audit row', (await profileLinkAudit()) === linkAuditBefore + 1);
check('5c the account is linked to that person', (await profileOf(ID.verifiedMatch)).person_id === prospect2Id);
r = await link(ID.coordinator, ID.emailChange, prospect2Id);
check('5d linking an account to a person who is already linked is refused (one account per person)', !r.ok && r.code === 'P0001', r.error);

r = await approve(ID.admin, ID.verifiedMatch);
check('5e approval succeeds after authorized linking', r.ok && r.rows.length === 1 && r.rows[0].status === 'active', r.error ?? JSON.stringify(r.rows));
check('5f approved account is active', (await profileOf(ID.verifiedMatch)).status === 'active');

// ── 6. Normal approval still works ─────────────────────────────────────────────────────────────────────────────────────
r = await approve(ID.admin, ID.newApplicant);
check('6a normal new-member approval (linked at signup) still succeeds', r.ok && r.rows[0]?.status === 'active', r.error);
r = await approve(ID.admin, ID.newApplicant);
check('6b approving an already active account returns no rows (unchanged behaviour)', r.ok && r.rows.length === 0, r.error);
r = await approve(ID.admin, ID.rejectedMatch);
check('6c approving a rejected account returns no rows (not pending; unchanged)', r.ok && r.rows.length === 0, r.error);

// ── 7. Queue shrinks after linking; audit cannot be altered ───────────────────────────────────────────────────────────
r = await queue('authenticated', ID.admin);
check('7a linked and approved account leaves the queue', r.ok && !r.rows.some((x) => x.profile_id === ID.verifiedMatch));
// Owner-side fixture: rename the new-email account's person and unlink the account, so the queue's no-candidate branch
// (LEFT JOIN with no match) is exercised.
await db.exec(`update public.people set email = 'renamed.link103@probe.invalid' where id = (select person_id from public.profiles where id = '${ID.verifiedNoMatch}')`);
await db.exec(`update public.profiles set person_id = null where id = '${ID.verifiedNoMatch}'`);
r = await queue('authenticated', ID.admin);
const noMatch = r.ok ? r.rows.find((x) => x.profile_id === ID.verifiedNoMatch) : undefined;
check('7b unlinked verified account with no matching person is listed with null candidate fields',
  !!noMatch && noMatch.person_id === null && noMatch.person_name === null, JSON.stringify(noMatch ?? null));
let upd = await as('authenticated', ID.admin, `update public.identity_read_audit set reason = 'x'`);
check('7c audit rows cannot be updated by the staff caller', !upd.ok, upd.error);
let audUpd;
try { await db.exec(`update public.identity_read_audit set reason = 'tamper' where target_kind = 'account_link'`); audUpd = 'NOT REFUSED'; }
catch (e) { audUpd = e.message; }
check('7d audit rows cannot be updated even by the owner (append-only trigger intact)', /cannot be changed or removed/.test(audUpd), audUpd);
let badKind = null;
try { await db.exec(`insert into public.identity_read_audit (actor_id, target_kind, target_id, reason) values ('${ID.admin}', 'bogus', '${NIL}', 'x valid')`); badKind = 'INSERTED'; }
catch (e) { badKind = e.message; }
check('7e target kinds outside claim, person and account_link are still refused', /check constraint/i.test(badKind), badKind);
const clientRead = await as('authenticated', ID.admin, `select count(*)::int n from public.identity_read_audit`);
check('7f authenticated callers still cannot read the audit table directly', !clientRead.ok, clientRead.error);

// ── 8. The unique person/account index is NOT part of 103 (pending duplicate-data review). One-person-one-account is
//      enforced by link_pending_profile_to_person (5d) and the row locks, not by an index.
check('8a the unique index is absent in this migration set', (await db.query(`select 1 from pg_indexes where indexname = 'profiles_person_id_linked_unique'`)).rows.length === 0);

// ── 9. Anonymous and client access to the new functions ───────────────────────────────────────────────────────────────
const grants = (await db.query(`
  select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('list_account_link_queue','approve_pending_member','link_pending_profile_to_person')`)).rows;
check('9a anon has no execute on any of the three functions', grants.length === 3 && grants.every((g) => g.anon_exec === false), JSON.stringify(grants));
check('9b authenticated has execute on the three functions (authorization is inside each one)', grants.every((g) => g.auth_exec === true));

// ── Summary ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed} passed, ${results.length - passed} failed of ${results.length}`);
process.exit(passed === results.length ? 0 : 1);
