// Certification for the final-candidate corrections (migrations 077 to 080).
//
// Runs in an isolated, in-process PGlite database built from the real migration files, as the roles a client uses.
//
// Usage:
//   PGLITE_MODULE=file:///.../node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/final_corrections_certification.mjs [migrationsDir]
//
// Exits non-zero on any FAIL.

import path from 'path';
import { fileURLToPath } from 'url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = process.argv[2] ?? path.join(here, '..', 'migrations');

const results = [];
const record = (area, name, ok, evidence = '') => {
  results.push({ area, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${area.padEnd(12)} ${name}${evidence ? `  [${evidence}]` : ''}`);
};
const denied = (area, name, r, pattern = null) => {
  const ok = !r.ok && (pattern === null || r.error.includes(pattern));
  record(area, name, ok, r.ok ? 'statement succeeded' : r.error.slice(0, 110));
};
const allowed = (area, name, r, evidence = '') => record(area, name, r.ok, r.ok ? evidence : r.error.slice(0, 110));

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = uid(1), COORD = uid(2), MEMBER = uid(3), TARGET = uid(4), PEND = uid(5), REJ = uid(6), CLEAN = uid(7);

async function main() {
  const { db, applied } = await openReplay(migrationsDir);
  console.log(`replayed ${applied.length} migrations; last ${applied.at(-1)}\n`);

  // Fixtures (owner). Everyone starts active; PEND and REJ are moved to their status after creation.
  const people = [[ADMIN, 'admin'], [COORD, 'coord'], [MEMBER, 'member'], [TARGET, 'target'], [PEND, 'pend'], [REJ, 'rej'], [CLEAN, 'clean']];
  const ids = people.map(([id]) => `'${id}'`).join(',');
  await db.exec(`
    insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
    select v.id::uuid, v.tag || '@final.invalid', 'x', 'authenticated', 'authenticated', now(), now()
    from (values ${people.map(([id, tag]) => `('${id}','${tag}')`).join(',')}) v(id, tag);
    update public.profiles set status = 'active', role = 'member' where id in (${ids});
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    update public.profiles set role = 'coordinator' where id = '${COORD}';
    update public.profiles set status = 'pending' where id = '${PEND}';
    update public.profiles set status = 'rejected' where id = '${REJ}';
  `);

  // ─── 080. set_member_status: the one authorised status path ──────────────────────────────────────────────────────
  denied('status', 'a member cannot change another account status',
    await attempt(db, 'authenticated', MEMBER, `select * from public.set_member_status($1, 'inactive', 'test')`, [TARGET]), 'Not authorised');
  denied('status', 'an admin cannot change their own status',
    await attempt(db, 'authenticated', ADMIN, `select * from public.set_member_status($1, 'inactive', 'test')`, [ADMIN]), 'own account');
  denied('status', 'an invalid status is refused',
    await attempt(db, 'authenticated', ADMIN, `select * from public.set_member_status($1, 'deleted', 'test')`, [TARGET]), 'valid status');
  denied('status', 'a status change without a reason is refused',
    await attempt(db, 'authenticated', ADMIN, `select * from public.set_member_status($1, 'inactive', '   ')`, [TARGET]), 'reason');
  denied('status', 'a pending account is not activated outside the approval flow',
    await attempt(db, 'authenticated', ADMIN, `select * from public.set_member_status($1, 'active', 'approve')`, [PEND]), 'approval');
  denied('status', 'a missing member is refused, not reported as saved',
    await attempt(db, 'authenticated', ADMIN, `select * from public.set_member_status($1, 'inactive', 'test')`, [uid(99)]), 'Member not found');
  const noop = await attempt(db, 'authenticated', ADMIN, `select * from public.set_member_status($1, 'active', 'no change')`, [TARGET]);
  denied('status', 'a no-op change is refused, not reported as saved', noop, 'already has that status');

  const changed = await attempt(db, 'authenticated', COORD, `select * from public.set_member_status($1, 'inactive', 'left the fellowship')`, [TARGET]);
  allowed('status', 'a coordinator changes a member to inactive with a reason', changed,
    changed.ok ? `status=${changed.rows[0]?.status}` : '');
  const statusNow = (await db.query(`select status from public.profiles where id = $1`, [TARGET])).rows[0]?.status;
  record('status', 'the saved status is visible to the database', statusNow === 'inactive', `status=${statusNow}`);
  const audit = (await db.query(
    `select count(*)::int n from public.member_status_audit where member_id = $1 and from_status = 'active' and to_status = 'inactive' and actor_id = $2 and reason = 'left the fellowship'`,
    [TARGET, COORD])).rows[0].n;
  record('audit', 'the change writes one member_status_audit row with actor and reason', audit === 1, `rows=${audit}`);

  const reactivated = await attempt(db, 'authenticated', ADMIN, `select * from public.set_member_status($1, 'active', 'returned')`, [TARGET]);
  allowed('status', 'an admin reactivates the member with a reason', reactivated);

  // Direct profile writes stay coordinator-only: an admin's direct status update saves no row (RLS, unchanged).
  const direct = await attempt(db, 'authenticated', ADMIN, `update public.profiles set status = 'inactive' where id = $1 returning id`, [CLEAN]);
  record('rls', 'a direct admin status update still saves no row (profile RLS unchanged)',
    direct.ok && direct.rows.length === 0, direct.ok ? `rows=${direct.rows.length}` : direct.error.slice(0, 90));
  const cleanStill = (await db.query(`select status from public.profiles where id = $1`, [CLEAN])).rows[0]?.status;
  record('rls', 'the account is unchanged after the refused direct update', cleanStill === 'active');

  // ─── 079. create_saved_group: active members only, bounded name ───────────────────────────────────────────────────
  allowed('groups', 'an admin creates a saved group of active members',
    await attempt(db, 'authenticated', ADMIN, `select public.create_saved_group($1, $2::uuid[]) as id`, ['Men', [TARGET]]));
  denied('groups', 'a pending account cannot be added to a saved group',
    await attempt(db, 'authenticated', ADMIN, `select public.create_saved_group($1, $2::uuid[]) as id`, ['Pend', [PEND]]), 'active profile');
  denied('groups', 'a rejected account cannot be added to a saved group',
    await attempt(db, 'authenticated', ADMIN, `select public.create_saved_group($1, $2::uuid[]) as id`, ['Rej', [REJ]]), 'active profile');
  denied('groups', 'a group name over 120 characters is refused',
    await attempt(db, 'authenticated', ADMIN, `select public.create_saved_group($1, $2::uuid[]) as id`, ['x'.repeat(121), [CLEAN]]), '1 to 120');
  denied('groups', 'a member cannot create a saved group',
    await attempt(db, 'authenticated', MEMBER, `select public.create_saved_group($1, $2::uuid[]) as id`, ['Mine', [CLEAN]]));

  // ─── 078. Events accept the composite audience mode ──────────────────────────────────────────────────────────────
  const eventCheck = (await db.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'events_audience_check'`)).rows[0]?.def ?? '';
  record('events', 'events accept the composite audience mode', eventCheck.includes("'composite'"), eventCheck.slice(0, 120));

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\nFINAL CORRECTIONS CERTIFICATION: PASS ${pass}  FAIL ${fail}  total ${results.length}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('CERTIFICATION ABORTED:', e.message);
  process.exit(2);
});
