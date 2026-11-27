// Contact person linking (migration 073) on PGlite, full chain. The database links each contact to exactly one person, from
// the contact's email. A cell leader's write never reveals whether an email is already on file, cannot attach a contact
// to an arbitrary person, and cannot relink an existing contact. Positive and negative controls.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/contact_identity_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [ident073] ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);
const P = (n) => `f3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: P(1), leaderA: P(2), leaderB: P(3), member: P(4) };
const CELL = { A: P(101), B: P(102) };
const PERSON = { known: P(201), unrelated: P(202) };
for (const [k, id] of Object.entries(U)) await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.ident073@website.invalid`, `Test ${k}`]);
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='member', status='active', cell_id=$2 where id=$1`, [U.leaderA, CELL.A]);
await owner(`update public.profiles set role='member', status='active', cell_id=$2 where id=$1`, [U.leaderB, CELL.B]);
await owner(`update public.profiles set role='member', status='active', cell_id=$2 where id=$1`, [U.member, CELL.A]);
await owner(`insert into public.cells (id,name,leader_id) values ($1,'A',$2),($3,'B',$4)`, [CELL.A, U.leaderA, CELL.B, U.leaderB]);
// A person already on file, in another cell's contact history, and an unrelated person.
await owner(`insert into public.people (id, full_name, email) values ($1,'Known Visitor','known.visitor@x.invalid'),($2,'Unrelated','unrelated@x.invalid')`, [PERSON.known, PERSON.unrelated]);

const insertContact = (uid, name, email, cell, extra = {}) => as(uid,
  `insert into public.contacts (contact_name, email, cell_id, logged_by, archived${extra.person !== undefined ? ', person_id' : ''})
   values ($1, $2, $3, $4, false${extra.person !== undefined ? ', $5' : ''}) returning id, person_id`,
  extra.person !== undefined ? [name, email, cell, uid, extra.person] : [name, email, cell, uid]);
const peopleByEmail = async (email) => (await owner(`select id from public.people where lower(email) = lower($1)`, [email])).rows.map((x) => x.id);
const personOf = async (contactId) => (await owner(`select person_id from public.contacts where id=$1`, [contactId])).rows[0]?.person_id;

// ── Positive: a leader logs a contact for a person already on file ───────────────────────────────────────────────────────
let r = await insertContact(U.leaderA, 'Known Visitor', 'known.visitor@x.invalid', CELL.A);
check('a leader logs a contact for a person already on file, without supplying a person id', r.ok && (await personOf(r.rows[0].id)) === PERSON.known, r.error);
check('no duplicate person row is created for an email already on file', (await peopleByEmail('known.visitor@x.invalid')).length === 1);

// ── No existence oracle: a new email and an existing email look the same to the leader ─────────────────────────────────
const existing = await insertContact(U.leaderA, 'Probe existing', 'known.visitor@x.invalid', CELL.A);
const fresh = await insertContact(U.leaderA, 'Probe fresh', 'never.seen.before@x.invalid', CELL.A);
check('the leader’s write succeeds in the same way whether or not the email is on file', existing.ok && fresh.ok && Object.keys(existing.rows[0]).join() === Object.keys(fresh.rows[0]).join(), `${existing.error ?? ''} ${fresh.error ?? ''}`);
check('a new email creates exactly one person, linked to the contact', (await peopleByEmail('never.seen.before@x.invalid')).length === 1 && (await personOf(fresh.rows[0].id)) === (await peopleByEmail('never.seen.before@x.invalid'))[0]);

// ── Normalization: the same address with case and spaces links to the same person ─────────────────────────────────────
r = await insertContact(U.leaderA, 'Known again', '  KNOWN.VISITOR@x.invalid ', CELL.A);
check('an email differing only by case and spaces links to the existing person', r.ok && (await personOf(r.rows[0].id)) === PERSON.known, r.error);

// ── A client-supplied person id is never trusted from a leader ───────────────────────────────────────────────────────
r = await insertContact(U.leaderA, 'Substitution attempt', 'substitute.target@x.invalid', CELL.A, { person: PERSON.unrelated });
check('negative: a leader cannot attach a new contact to an arbitrary person id', r.ok && (await personOf(r.rows[0].id)) !== PERSON.unrelated, r.error ?? 'attached');
check('the substituted id did not gain a contact or change the unrelated person', (await owner(`select count(*)::int n from public.contacts where person_id=$1 and contact_name='Substitution attempt'`, [PERSON.unrelated])).rows[0].n === 0);

// ── Relinking an existing contact is refused for a leader ────────────────────────────────────────────────────────────────
const target = r.rows[0].id;
r = await as(U.leaderA, `update public.contacts set person_id=$1 where id=$2`, [PERSON.unrelated, target]);
check('negative: a leader cannot relink an existing contact to another person', !r.ok && (await personOf(target)) !== PERSON.unrelated, r.error ?? 'relinked');

// ── Duplicate prevention under repeated writes of the same new person ────────────────────────────────────────────────────
await insertContact(U.leaderA, 'Twin one', 'twin.visitor@x.invalid', CELL.A);
r = await insertContact(U.leaderB, 'Twin two', 'twin.visitor@x.invalid', CELL.B);
check('two leaders in different cells logging the same new person create one person record', (await peopleByEmail('twin.visitor@x.invalid')).length === 1, r.error);
check('both contacts link to that single person', (await owner(`select count(distinct person_id)::int n from public.contacts where contact_name in ('Twin one','Twin two')`)).rows[0].n === 1);

// ── A contact without an email still gets its own person (current behaviour preserved) ───────────────────────────────────
r = await insertContact(U.leaderA, 'No Email Visitor', null, CELL.A);
check('a contact without an email is linked to a new person', r.ok && (await personOf(r.rows[0].id)) !== null, r.error);

// ── Authority and boundaries ────────────────────────────────────────────────────────────────────────────────────────────
r = await insertContact(U.leaderB, 'Cross cell', 'cross.cell@x.invalid', CELL.A);
check('negative: a leader of cell B cannot log a contact into cell A', !r.ok, r.ok ? 'inserted' : r.error);
r = await insertContact(U.member, 'Member attempt', 'member.attempt@x.invalid', CELL.A);
check('negative: an ordinary member cannot log a contact', !r.ok, r.ok ? 'inserted' : r.error);
r = await insertContact(U.admin, 'Staff contact', 'staff.contact@x.invalid', CELL.A, { person: PERSON.unrelated });
check('staff may supply an explicit person link (trusted authority)', r.ok && (await personOf(r.rows[0].id)) === PERSON.unrelated, r.error);

// ── The email lookup is gone; direct calls fail ────────────────────────────────────────────────────────────────────────
r = await as(U.leaderA, `select public.find_person_id_for_contact('known.visitor@x.invalid')`);
check('the email lookup for contact logging is removed', !r.ok, r.ok ? 'still callable' : r.error);

const failed = results.filter((x) => !x).length;
console.log(`\nCONTACT IDENTITY 073 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
