// Role-by-role authorization for public.people after migration 095, on a DISPOSABLE in-process PGlite replay of 000-095.
// No Docker, no network, no hosted database. Fake accounts only. Exit 1 on any failed expectation.
//
// Run:  PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/people_privacy_pglite_test.mjs
//
// Limits: PGlite is not a Supabase stack. The shim provides auth.uid()/auth.role() from request.jwt.* settings, and the
// service_role role is created BYPASSRLS as Supabase does. This certifies the SQL policy and grant behaviour only.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', 'migrations'));

const results = [];
const check = (area, name, ok, detail = '') => {
  results.push({ area, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? ' :: ' + detail : ''}`);
};
const as = (role, uid, sql, params = []) => attempt(db, role, uid, sql, params);
const count = async (role, uid, sql, params = []) => {
  const r = await as(role, uid, `select count(*)::int n from (${sql}) x`, params);
  return r.ok ? r.rows[0].n : `ERR ${r.error}`;
};
// Owner writes that change cell_id must state a reason first. The audit trigger consumes the reason after each change (093).
const owner = async (sql, params = []) => {
  if (/cell_id\s*=/.test(sql)) await db.query(`select set_config('app.cell_change_reason', 'people probe setup', false)`);
  return db.query(sql, params);
};

// ── Accounts. Signup (019) creates a pending profile and a linked people row for each auth user, as in production.
const A = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  coord: 'a0000000-0000-4000-8000-000000000002',
  leaderA: 'a0000000-0000-4000-8000-00000000000a',
  leaderB: 'a0000000-0000-4000-8000-00000000000b',
  memberA: 'a0000000-0000-4000-8000-0000000000aa',
  memberB: 'a0000000-0000-4000-8000-0000000000bb',
  pendingA: 'a0000000-0000-4000-8000-0000000000da',
  rejectedA: 'a0000000-0000-4000-8000-0000000000ea',
};
const EMAIL = {
  admin: 'admin.people@probe.invalid', coord: 'coord.people@probe.invalid',
  leaderA: 'leadera.people@probe.invalid', leaderB: 'leaderb.people@probe.invalid',
  memberA: 'membera.people@probe.invalid', memberB: 'memberb.people@probe.invalid',
  pendingA: 'pendinga.people@probe.invalid', rejectedA: 'rejecteda.people@probe.invalid',
};
const CA = 'a0000000-0000-4000-8000-0000000000c1';
const CB = 'a0000000-0000-4000-8000-0000000000c2';
const WALKIN_EMAIL = 'walkin.people@probe.invalid';

await owner(`select set_config('app.cell_change_reason', 'people probe setup', false)`);
for (const [k, id] of Object.entries(A)) {
  await owner(
    `insert into auth.users (id, email, aud, role, created_at, raw_user_meta_data)
     values ($1, $2, 'authenticated', 'authenticated', now(), jsonb_build_object('full_name', $3::text))`,
    [id, EMAIL[k], `Probe ${k}`],
  );
}
await owner(`insert into public.cells (id, name) values ($1, 'Cell A'), ($2, 'Cell B')`, [CA, CB]);
// Promote the signup-created profiles as the owner would through the approved workflows.
await owner(`update public.profiles set role = 'admin', status = 'active' where id = $1`, [A.admin]);
await owner(`update public.profiles set role = 'coordinator', status = 'active' where id = $1`, [A.coord]);
await owner(`update public.profiles set role = 'cell_leader', status = 'active', cell_id = $2 where id = $1`, [A.leaderA, CA]);
await owner(`update public.profiles set role = 'cell_leader', status = 'active', cell_id = $2 where id = $1`, [A.leaderB, CB]);
await owner(`update public.profiles set status = 'active', cell_id = $2 where id = $1`, [A.memberA, CA]);
await owner(`update public.profiles set status = 'active', cell_id = $2 where id = $1`, [A.memberB, CB]);
await owner(`update public.profiles set status = 'active' where id = $1`, [A.rejectedA]);
await owner(`update public.profiles set status = 'rejected' where id = $1`, [A.rejectedA]);
await owner(`update public.cells set leader_id = $2 where id = $1`, [CA, A.leaderA]);
await owner(`update public.cells set leader_id = $2 where id = $1`, [CB, A.leaderB]);
// Walk-in person (not an account), created by staff.
const walkin = (await owner(`insert into public.people (full_name, email) values ('Walk In', $1) returning id`, [WALKIN_EMAIL])).rows[0].id;

const personOf = async (uid) => (await owner(`select person_id from public.profiles where id = $1`, [uid])).rows[0].person_id;
const P = {};
for (const k of Object.keys(A)) P[k] = await personOf(A[k]);
const pendingPerson = P.pendingA;

// Sanity for the fixture itself: the pending applicant's people row exists and is linked (as 019 does).
check('Fixture', 'pending applicant has a linked people row created at signup', !!pendingPerson && (await owner(`select 1 from public.people where id = $1`, [pendingPerson])).rows.length === 1);

// ── 1. people reads by role (SELECT by id)
const seeRow = (role, uid, personId) => count(role, uid, `select id from public.people where id = $1`, [personId]);
const rowSql = [pendingPerson];

check('Admin', 'admin reads pending applicant people row', (await seeRow('authenticated', A.admin, pendingPerson)) === 1);
check('Coordinator', 'coordinator reads pending applicant people row', (await seeRow('authenticated', A.coord, pendingPerson)) === 1);
check('Cell leader', 'cell leader of the applicant\'s (no) cell cannot read the pending people row (leader A)', (await seeRow('authenticated', A.leaderA, pendingPerson)) === 0);
check('Cell leader', 'cell leader B cannot read pending people row', (await seeRow('authenticated', A.leaderB, pendingPerson)) === 0);
check('Member', 'ordinary active member cannot read pending applicant people row', (await seeRow('authenticated', A.memberA, pendingPerson)) === 0);
// 099 (N1, design 3.3): only an ACTIVE account reads its linked person. A pending applicant reads no person row.
check('Applicant', 'pending applicant reads no own people row (099: active-only)', (await seeRow('authenticated', A.pendingA, pendingPerson)) === 0);
check('Applicant', 'another pending applicant cannot read this people row (rejected applicant)', (await seeRow('authenticated', A.rejectedA, pendingPerson)) === 0);
const anonPeople = await count('anon', null, `select id from public.people`);
check('Anon', 'anon reads no people rows (no table privilege, so the read is refused)', anonPeople === 0 || String(anonPeople).startsWith('ERR'), String(anonPeople));

// ── 2. Preserved reads (outreach, contact search, walk-ins, rejected)
check('Preserved', 'active member reads another active member\'s people row', (await seeRow('authenticated', A.memberA, P.memberB)) === 1);
check('Preserved', 'active member reads a walk-in people row (contact search)', (await seeRow('authenticated', A.memberA, walkin)) === 1);
check('Preserved', 'cell leader reads an active member\'s people row in own cell', (await seeRow('authenticated', A.leaderA, P.memberA)) === 1);
check('Tightened', 'rejected account cannot read another member\x27s people row (not an active account)', (await seeRow('authenticated', A.rejectedA, P.memberB)) === 0);
// 099 (N1, design 3.3): a rejected account is not active, so it reads no person row, its own included.
check('Preserved', 'rejected applicant reads no own people row (099: active-only)', (await seeRow('authenticated', A.rejectedA, P.rejectedA)) === 0);
// 095 (people_read): a person linked to a PENDING or REJECTED profile is readable only by its owner (now refused, 099) and
// by admins and coordinators. An ordinary cell leader, who is an active member, is refused. The rejected applicant's
// identity is not made public by rejection (095 decision). Staff keep the read (positive control below).
check('Rejected applicant', 'cell leader cannot read a rejected applicant\'s people row (095: pending or rejected profiles are staff-only)', (await seeRow('authenticated', A.leaderA, P.rejectedA)) === 0);
check('Rejected applicant', 'admin still reads a rejected applicant\'s people row (positive control, staff visibility)', (await seeRow('authenticated', A.admin, P.rejectedA)) === 1);

// ── 3. Email lookup. Migration 098 withdraws find_person_by_email from every client role. Identity is resolved inside
// submit_contact, and staff read identity only through get_person_identity, which is audited.
const lookup = (uid, email) => as('authenticated', uid, `select public.find_person_by_email($1) as id`, [email]);
const lk1 = await lookup(A.memberA, WALKIN_EMAIL);
check('Lookup', 'member cannot call the retired email lookup (execute revoked by 098)', !lk1.ok, lk1.error ?? 'call succeeded');
const lk2 = await lookup(A.memberA, EMAIL.pendingA);
check('Lookup', 'member cannot probe a pending applicant\'s email through the lookup (no id leak)', !lk2.ok, lk2.error ?? JSON.stringify(lk2.rows));
const lk3 = await lookup(A.admin, EMAIL.pendingA);
check('Lookup', 'admin cannot call the retired email lookup either (staff use get_person_identity)', !lk3.ok, lk3.error ?? 'call succeeded');
const lk4 = await lookup(A.leaderA, EMAIL.pendingA);
check('Lookup', 'cell leader cannot call the retired email lookup', !lk4.ok, lk4.error ?? 'call succeeded');
const staffId = await as('authenticated', A.admin, `select full_name, email from public.get_person_identity($1, 'PGlite review of applicant')`, [pendingPerson]);
check('Lookup', 'admin resolves a pending applicant\'s identity through the audited staff read (positive control)', staffId.ok && staffId.rows[0].email === EMAIL.pendingA, staffId.error);

// ── 4. Direct email/phone reads of a pending row, by column (column privilege withdrawn by 098)
const emailOf = (uid, personId) => as('authenticated', uid, `select email, phone from public.people where id = $1`, [personId]);
const leakA = await emailOf(A.leaderA, pendingPerson);
check('Privacy', 'cell leader cannot read the pending applicant\'s email or phone (column not granted, 098)', !leakA.ok, leakA.error ?? JSON.stringify(leakA.rows));
const listLeak = await as('authenticated', A.leaderA, `select email from public.people where email = $1`, [EMAIL.pendingA]);
check('Privacy', 'cell leader cannot filter people by the pending email (column not granted, 098)', !listLeak.ok, listLeak.error ?? JSON.stringify(listLeak.rows));

// ── 5. Writes by role. Direct insert into people is withdrawn from clients (098); contact logging goes through
// submit_contact (097), which is exercised here as the positive control.
const createdByMember = await as('authenticated', A.memberA, `insert into public.people (full_name, email) values ('New Walk In', 'newwalkin.people@probe.invalid') returning id`);
check('Write', 'active member direct insert into people is refused (use submit_contact)', !createdByMember.ok, createdByMember.error ?? 'insert succeeded');
const viaSubmit = await as('authenticated', A.memberA, `select outcome from public.submit_contact($1, null, null, $2, false, '', '', '', null, null, false, $3)`, ['Walk In via submit', 'newwalkin.people@probe.invalid', 'pglite-walkin-1']);
check('Outreach', 'active member logs a contact with a new email through submit_contact (contact logging path)', viaSubmit.ok && viaSubmit.rows[0].outcome === 'logged', viaSubmit.error);
const dupPending = await as('authenticated', A.memberA, `insert into public.people (full_name, email) values ('Dup', $1)`, [EMAIL.pendingA]);
check('Privacy', 'member direct insert of a pending applicant\'s email is refused by privilege, so no unique-index oracle is reachable', !dupPending.ok, dupPending.error);
const updByMember = await as('authenticated', A.memberA, `update public.people set full_name = 'Hacked' where id = $1`, [P.memberB]);
check('Write', 'ordinary member cannot update another person', !updByMember.ok || (await owner(`select full_name from public.people where id = $1`, [P.memberB])).rows[0].full_name !== 'Hacked', updByMember.error ?? 'zero rows');
// Identity changes go through update_person_identity (097): staff only, with a reason, audited. 098 withdrew direct UPDATE
// and DELETE on people from every client role, so the direct statements below must be refused for everyone, including
// admins and coordinators. The 045 policy still exists but has no effect without the privilege.
const identityByAdmin = await as('authenticated', A.admin, `select public.update_person_identity($1, $2, $3, $4, $5)`,
  [walkin, 'Walk In', WALKIN_EMAIL, '555-0199', 'PGlite identity review of walk-in phone']);
const phoneAfter = (await owner(`select phone from public.people where id = $1`, [walkin])).rows[0].phone;
check('Identity', 'admin changes a walk-in phone through the authorised RPC update_person_identity (audited)', identityByAdmin.ok && phoneAfter === '555-0199', identityByAdmin.error ?? `phone=${phoneAfter}`);
const updByAdmin = await as('authenticated', A.admin, `update public.people set phone = '555-0123' where id = $1`, [walkin]);
check('Unauthorized direct UPDATE', 'admin direct UPDATE of people is refused (identity goes through update_person_identity, 098)', !updByAdmin.ok, updByAdmin.error ?? 'update succeeded');
const delByCoord = await as('authenticated', A.coord, `delete from public.people where id = $1`, [walkin]);
check('Unauthorized direct DELETE', 'coordinator direct DELETE of a person is refused (098 revoked DELETE; 045 policy has no effect)', !delByCoord.ok, delByCoord.error ?? 'delete succeeded');
check('Unauthorized direct DELETE', 'the walk-in person still exists after the refused delete', (await owner(`select 1 from public.people where id = $1`, [walkin])).rows.length === 1);
const delByMember = await as('authenticated', A.memberA, `delete from public.people where id = $1`, [P.memberB]);
check('Write', 'ordinary member cannot delete a person (row still exists)', (await owner(`select 1 from public.people where id = $1`, [P.memberB])).rows.length === 1, delByMember.error ?? 'zero rows');

// ── 6. service_role (bypasses RLS by design in Supabase; documented, not an application path)
check('service_role', 'service_role reads the pending row (BYPASSRLS, documented)', (await seeRow('service_role', null, pendingPerson)) === 1);

// ── 7. Helper privilege
// The helper was renamed to person_has_unapproved_profile by migration 095 (pending OR rejected).
const helperAnon = await as('anon', null, `select public.person_has_unapproved_profile($1)`, [pendingPerson]);
check('Helpers', 'anon cannot execute person_has_unapproved_profile', !helperAnon.ok);
const helperAuth = await as('authenticated', A.memberA, `select public.person_has_unapproved_profile($1) as p`, [pendingPerson]);
check('Helpers', 'authenticated may execute person_has_unapproved_profile and it reports true for the pending row', helperAuth.ok && helperAuth.rows[0].p === true, helperAuth.error);

const failed = results.filter((x) => !x.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed on disposable PGlite (not Supabase)`);
process.exit(failed ? 1 : 0);
