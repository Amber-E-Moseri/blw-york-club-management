// Regression: a cell-change reason is consumed by the one audit row it describes (migration 093).
// Runs on a DISPOSABLE in-process PGlite replay of 000-095. Two cell changes happen inside ONE transaction.
//
// Expected failures run inside SAVEPOINTs, so the failing statement aborts only its own savepoint, not the transaction.
// The sequence ends with a deliberate ROLLBACK, so every assertion is taken before the rollback and the replay is left
// unchanged. Exit 1 on any failed expectation.
//
// Run:  PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/audit_reason_consumption_pglite_test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', 'migrations'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [Audit reason] ${name}${detail ? ' :: ' + detail : ''}`);
};

const COORD = 'b0000000-0000-4000-8000-000000000002';
const MEMBER = 'b0000000-0000-4000-8000-0000000000aa';
const CA = 'b0000000-0000-4000-8000-0000000000c1';
const CB = 'b0000000-0000-4000-8000-0000000000c2';
const FIRST = 'First authorized move: joined the Thursday group';
const SECOND = 'Second authorized move: leader change, new reason';

// ── Fixture (owner, outside the transaction under test)
await db.query(`select set_config('app.cell_change_reason', 'audit probe setup', false)`);
for (const [id, email] of [[COORD, 'coord.audit@probe.invalid'], [MEMBER, 'member.audit@probe.invalid']]) {
  await db.query(
    `insert into auth.users (id, email, aud, role, created_at) values ($1, $2, 'authenticated', 'authenticated', now())`,
    [id, email],
  );
}
await db.query(`insert into public.cells (id, name) values ($1, 'Audit Cell A'), ($2, 'Audit Cell B')`, [CA, CB]);
await db.query(`update public.profiles set role = 'coordinator', status = 'active' where id = $1`, [COORD]);
await db.query(`update public.profiles set status = 'active' where id = $1`, [MEMBER]);
await db.query(`select set_config('app.cell_change_reason', 'audit probe setup', false)`);
await db.query(`update public.profiles set cell_id = $2 where id = $1`, [MEMBER, CA]);

const auditRows = (tx) =>
  tx.query(`select reason, actor_id, from_cell_id, to_cell_id, changed_at from public.member_cell_audit where member_id = $1 order by id`, [MEMBER]);
const cellNow = async (tx) => (await tx.query(`select cell_id from public.profiles where id = $1`, [MEMBER])).rows[0].cell_id;
const asRole = (tx, role, uid) =>
  tx.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', true); set role ${role};`);
const asOwner = (tx) => tx.exec(`reset role; select set_config('request.jwt.claim.sub', '', true);`);

const baseline = (await db.query(`select count(*)::int n from public.member_cell_audit where member_id = $1`, [MEMBER])).rows[0].n;
const cellBefore = (await db.query(`select cell_id from public.profiles where id = $1`, [MEMBER])).rows[0].cell_id;
check('Setup: baseline audit rows and starting cell', baseline === 1 && cellBefore === CA, `baseline=${baseline}`);

// The transaction is rolled back at the end on purpose. Throwing from the callback is how PGlite rolls back.
const ROLLBACK = new Error('deliberate rollback: the probe leaves the replay unchanged');
let inside = {};
try {
  await db.transaction(async (tx) => {
    // ── Step 1: first authorized change, valid reason, as the coordinator.
    await asRole(tx, 'authenticated', COORD);
    await tx.query(`select * from public.transfer_member_cell($1, $2, $3)`, [MEMBER, CB, FIRST]);
    await asOwner(tx);
    inside.afterFirst = (await auditRows(tx)).rows;
    inside.cellAfterFirst = await cellNow(tx);

    // ── Step 2a: second change with NO new reason, as the owner (the path that could reuse a stale reason).
    await tx.exec('savepoint no_reason_owner');
    let err2a = null;
    try {
      await tx.query(`update public.profiles set cell_id = $2 where id = $1`, [MEMBER, CA]);
    } catch (e) { err2a = e; }
    await tx.exec('rollback to savepoint no_reason_owner');
    inside.err2a = err2a ? err2a.message : null;
    inside.afterSecond = (await auditRows(tx)).rows;
    inside.cellAfterSecond = await cellNow(tx);

    // ── Step 2b: second change through the RPC with a blank reason, as the coordinator.
    await asRole(tx, 'authenticated', COORD);
    await tx.exec('savepoint blank_reason_rpc');
    let err2b = null;
    try {
      await tx.query(`select * from public.transfer_member_cell($1, $2, $3)`, [MEMBER, CA, '   ']);
    } catch (e) { err2b = e; }
    await tx.exec('rollback to savepoint blank_reason_rpc');
    await asOwner(tx);
    inside.err2b = err2b ? err2b.message : null;
    inside.afterBlank = (await auditRows(tx)).rows;

    // ── Step 3: a later authorized change with a NEW reason succeeds and records that distinct reason.
    await asRole(tx, 'authenticated', COORD);
    await tx.query(`select * from public.transfer_member_cell($1, $2, $3)`, [MEMBER, CA, SECOND]);
    await asOwner(tx);
    inside.afterThird = (await auditRows(tx)).rows;
    inside.cellAfterThird = await cellNow(tx);

    throw ROLLBACK;
  });
} catch (e) {
  if (e !== ROLLBACK) throw e;
}

// ── Assertions (taken from the values captured inside the transaction)
check('1. first authorized change succeeds and produces exactly one audit row',
  inside.afterFirst.length === baseline + 1 && inside.cellAfterFirst === CB,
  `rows=${inside.afterFirst.length}`);
check('1. first row carries the first reason, the coordinator as actor, and a timestamp',
  inside.afterFirst.at(-1).reason === FIRST && inside.afterFirst.at(-1).actor_id === COORD && inside.afterFirst.at(-1).changed_at != null);

check('2a. owner-run change with no new reason fails',
  typeof inside.err2a === 'string' && /reason/i.test(inside.err2a), String(inside.err2a));
check('2a. the failed change left the cell where the first change put it', inside.cellAfterSecond === CB);
check('3. no audit row is written by the failed change (2a)', inside.afterSecond.length === baseline + 1, `rows=${inside.afterSecond.length}`);

check('2b. RPC with a blank reason fails', typeof inside.err2b === 'string' && /reason/i.test(inside.err2b), String(inside.err2b));
check('3. no audit row is written by the failed change (2b)', inside.afterBlank.length === baseline + 1, `rows=${inside.afterBlank.length}`);

check('4. a subsequent authorized change with a new reason succeeds', inside.cellAfterThird === CA);
check('4. it records exactly one further audit row with the NEW reason',
  inside.afterThird.length === baseline + 2 && inside.afterThird.at(-1).reason === SECOND,
  `rows=${inside.afterThird.length}`);
check('4. the two recorded reasons are distinct and each is preserved on its own row',
  inside.afterThird.at(-2).reason === FIRST && inside.afterThird.at(-1).reason === SECOND && FIRST !== SECOND);

// The rollback must have restored the replay state (proves the probe did not leak into the disposable database).
const after = (await db.query(`select count(*)::int n from public.member_cell_audit where member_id = $1`, [MEMBER])).rows[0].n;
const cellFinal = (await db.query(`select cell_id from public.profiles where id = $1`, [MEMBER])).rows[0].cell_id;
check('Rollback: audit rows and cell are back to the baseline', after === baseline && cellFinal === CA, `rows=${after}`);
const gucAfter = (await db.query(`select current_setting('app.cell_change_reason', true) as v`)).rows[0].v;
check('Rollback: no reason value survives the transaction at session scope', (gucAfter ?? '') === '', JSON.stringify(gucAfter));

const failed = results.filter((x) => !x.ok).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed on disposable PGlite (not Supabase)`);
process.exit(failed ? 1 : 0);
