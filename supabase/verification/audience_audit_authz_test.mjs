// audience_audit_authz_test.mjs
// Regression tests for the integrated 071-101 chain: S1 (audience oracle), S3 (audit append-only) and S4 (trigger function
// EXECUTE). Runs on an isolated in-process PGlite replay of a migrations directory. No hosted or protected database.
//
//   PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js \
//     node audience_audit_authz_test.mjs <migrationsDir>
//
// Ported from the PR #6 lineage. Assertions that depend on PR #6's migration 076 (its invitation policy, its
// is_in_audience_spec helper) are NOT carried, because that lineage is not part of this chain. Each protection below is
// the one this chain provides:
//   S1  meeting_audience_spec refuses non-managers (F2 082). No PR #6 oracle helper exists in this chain.
//   S3  cell_admin_audit and member_cell_audit refuse UPDATE and DELETE for every role, owner included (101).
//   S4  audience_specs_block_change is not executable by PUBLIC or authenticated (F2).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) {
  console.error('refused: set PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const migDir = process.argv[2];
if (!migDir) {
  console.error('usage: node audience_audit_authz_test.mjs <migrationsDir>');
  process.exit(2);
}
const { openReplay, attempt } = await import(pathToFileURL(path.join(here, 'pglite_replay.mjs')).href);
const { db } = await openReplay(migDir);

const U = (n) => `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
const ATTACKER = U('a1');
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const as = (role, uid, sql, params = []) => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => attempt(db, 'owner', null, sql, params);

// An active ordinary member who is not a manager of any meeting. Created through the real signup trigger.
await db.query(`insert into auth.users (id, email, aud, role, created_at, raw_user_meta_data)
                values ($1, 'attacker.audit@probe.invalid', 'authenticated', 'authenticated', now(), '{"full_name":"Attacker"}')`, [ATTACKER]);
await db.query(`update public.profiles set status = 'active', role = 'member' where id = $1`, [ATTACKER]);

// ── S1: audience oracle. A non-manager may not read a meeting's audience spec.
const s1 = await as('authenticated', ATTACKER, `select public.meeting_audience_spec($1) as spec`, [U('d001')]);
check('S1a non-manager is refused meeting_audience_spec (F2 082: raises 42501)',
  !s1.ok && s1.code === '42501', s1.ok ? `returned ${JSON.stringify(s1.rows)}` : s1.error);
check('S1b no is_in_audience_spec oracle helper exists in this chain (PR #6 076 is not carried)',
  (await db.query(`select to_regprocedure('public.is_in_audience_spec(uuid,uuid)') is null as absent`)).rows[0].absent === true);

// ── S3: audit history is append-only for every role, owner included (101 on cell_admin_audit and member_cell_audit).
const cellAuditId = (await db.query(`insert into public.cell_admin_audit (cell_id, action, actor_id, changed_at)
                                     values ($1, 'insert', null, now()) returning id`, [U('c1')])).rows[0].id;
const memberAuditId = (await db.query(`insert into public.member_cell_audit (member_id, from_cell_id, to_cell_id, actor_id, changed_at)
                                       values ($1, null, $2, null, now()) returning id`, [U('b1'), U('c1')])).rows[0].id;

for (const [table, id] of [['cell_admin_audit', cellAuditId], ['member_cell_audit', memberAuditId]]) {
  const upd = await owner(`update public.${table} set changed_at = now() where id = $1`, [id]);
  check(`S3a owner cannot UPDATE ${table} (trigger refuses every role)`, !upd.ok, upd.ok ? 'UPDATE succeeded' : '');
  const del = await owner(`delete from public.${table} where id = $1`, [id]);
  check(`S3b owner cannot DELETE ${table} (trigger refuses every role)`, !del.ok, del.ok ? 'DELETE succeeded' : '');
  const svcUpd = await as('service_role', null, `update public.${table} set changed_at = now() where id = $1`, [id]);
  check(`S3c service_role cannot UPDATE ${table}`, !svcUpd.ok, svcUpd.ok ? 'UPDATE succeeded' : '');
  const svcDel = await as('service_role', null, `delete from public.${table} where id = $1`, [id]);
  check(`S3d service_role cannot DELETE ${table}`, !svcDel.ok, svcDel.ok ? 'DELETE succeeded' : '');
  const authDel = await as('authenticated', ATTACKER, `delete from public.${table} where id = $1`, [id]);
  check(`S3e authenticated cannot DELETE ${table}`, !authDel.ok, authDel.ok ? 'DELETE succeeded' : '');
  const trig = (await db.query(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
                                where c.relname = $1 and t.tgname = $2 and not t.tgisinternal and t.tgenabled = 'O'`,
    [table, `${table}_append_only`])).rows[0].n;
  check(`S3f ${table}_append_only trigger is present and enabled`, trig === 1, `found ${trig}`);
}

// ── S4: the trigger function is not a client entry point.
const exec = (await db.query(`select has_function_privilege('public', 'public.audience_specs_block_change()', 'EXECUTE') as p,
                                     has_function_privilege('authenticated', 'public.audience_specs_block_change()', 'EXECUTE') as a`)).rows[0];
check('S4a PUBLIC and authenticated cannot EXECUTE audience_specs_block_change', !exec.p && !exec.a, JSON.stringify(exec));

const passed = results.filter((c) => c.pass).length;
for (const c of results) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` :: ${c.detail}` : ''}`);
console.log(`\n${passed}/${results.length} audience and audit checks passed on disposable PGlite (not Supabase)`);
process.exit(passed === results.length ? 0 : 1);
