// Assignment workflow certification: creation, progress and review, as the roles the Tasks page uses.
//
// Runs in an isolated, in-process PGlite database built from the real migration files.
//
// Usage:
//   PGLITE_MODULE=file:///.../node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/assignments_certification.mjs [migrationsDir]
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
  const ok = !r.ok || r.rows.length === 0;
  const matches = pattern === null || (!r.ok && r.error.includes(pattern));
  record(area, name, ok && matches, r.ok ? `saved ${r.rows.length} rows` : r.error.slice(0, 110));
};
const allowed = (area, name, r, evidence = '') => record(area, name, r.ok && r.rows.length >= 0, r.ok ? evidence : r.error.slice(0, 110));

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = uid(1), LEADER = uid(2), A1 = uid(3), A2 = uid(4), OUTSIDER = uid(5), CELL = uid(6);

async function main() {
  const { db, applied } = await openReplay(migrationsDir);
  console.log(`replayed ${applied.length} migrations; last ${applied.at(-1)}\n`);

  await db.exec(`
    insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
    select v.id::uuid, v.tag || '@asg.invalid', 'x', 'authenticated', 'authenticated', now(), now()
    from (values ('${ADMIN}','admin'),('${LEADER}','leader'),('${A1}','a1'),('${A2}','a2'),('${OUTSIDER}','out')) v(id, tag);
    update public.profiles set status = 'active', role = 'member' where id in ('${ADMIN}','${LEADER}','${A1}','${A2}','${OUTSIDER}');
    update public.profiles set role = 'admin' where id = '${ADMIN}';
    update public.profiles set role = 'cell_leader' where id = '${LEADER}';
    insert into public.cells (id, name, leader_id) values ('${CELL}', 'Assign Cell', '${LEADER}');
    update public.profiles set cell_id = '${CELL}' where id in ('${LEADER}', '${A1}');
  `);

  // ─── Creation ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const created = await attempt(db, 'authenticated', ADMIN,
    `select public.create_assignments($1, $2, null, 'normal', $3::uuid[]) as id`, ['Visit the new member', 'Coffee', [A1, A2]]);
  allowed('create', 'an admin creates one task for two people in one call', created);
  const rows = (await db.query(`select id, assigned_to, batch_id, status, reviewed_at, title from public.assignments where title = 'Visit the new member'`)).rows;
  record('create', 'the call writes one row per assignee sharing a batch', rows.length === 2 && rows[0].batch_id === rows[1].batch_id, `rows=${rows.length}`);
  const batch = rows[0]?.batch_id;
  const rowA1 = rows.find((r) => r.assigned_to === A1)?.id;
  const rowA2 = rows.find((r) => r.assigned_to === A2)?.id;

  allowed('create', 'a cell leader assigns a member of their own cell',
    await attempt(db, 'authenticated', LEADER, `select public.create_assignments($1, null, null, 'normal', $2::uuid[])`, ['Call them', [A1]]));
  denied('create', 'a leader cannot assign someone outside their cell',
    await attempt(db, 'authenticated', LEADER, `select public.create_assignments($1, null, null, 'normal', $2::uuid[])`, ['Not mine', [OUTSIDER]]));

  // ─── Progress (the assignee's own status) ──────────────────────────────────────────────────────────────────────────
  allowed('progress', 'an assignee completes their own row',
    await attempt(db, 'authenticated', A1, `update public.assignments set status = 'completed' where id = $1 returning id`, [rowA1]));
  const completedAt = (await db.query(`select completed_at from public.assignments where id = $1`, [rowA1])).rows[0]?.completed_at;
  record('progress', 'completion stamps completed_at', completedAt !== null && completedAt !== undefined);

  denied('progress', 'an assignee cannot touch another person’s row',
    await attempt(db, 'authenticated', A1, `update public.assignments set status = 'completed' where id = $1 returning id`, [rowA2]));

  // ─── Review: a manager action only ───────────────────────────────────────────────────────────────────────────────
  // The Tasks page sends reviewed_at for review. A member must not be able to mark their own task reviewed.
  const selfReview = await attempt(db, 'authenticated', A1,
    `update public.assignments set reviewed_at = now() where id = $1 returning id`, [rowA1]);
  const stamped = (await db.query(`select reviewed_at from public.assignments where id = $1`, [rowA1])).rows[0]?.reviewed_at;
  record('review', 'an assignee cannot mark their own task reviewed', !(selfReview.ok && selfReview.rows.length) && !stamped,
    selfReview.ok ? `returned ${selfReview.rows.length}, reviewed_at=${stamped ?? 'null'}` : selfReview.error.slice(0, 90));

  allowed('review', 'an admin reviews a completed row',
    await attempt(db, 'authenticated', ADMIN, `update public.assignments set reviewed_at = now() where id = $1 returning id`, [rowA1]));
  denied('review', 'a cell leader cannot review assignments',
    await attempt(db, 'authenticated', LEADER, `update public.assignments set reviewed_at = now() where id = $1 returning id`, [rowA2]));

  // A pending row must not be reviewable by its assignee either (the status USING clause does not cover this case).
  await attempt(db, 'authenticated', A2, `update public.assignments set reviewed_at = now() where id = $1 returning id`, [rowA2]);
  const pendingStamp = (await db.query(`select reviewed_at from public.assignments where id = $1`, [rowA2])).rows[0]?.reviewed_at;
  record('review', 'an assignee cannot stamp reviewed_at on a pending row of their own', pendingStamp === null,
    `reviewed_at=${pendingStamp ?? 'null'}`);

  // ─── Editing the task itself: the assignee may only move status ───────────────────────────────────────────────────
  const retitle = await attempt(db, 'authenticated', A2,
    `update public.assignments set title = 'Changed by assignee' where id = $1 returning id`, [rowA2]);
  const titleNow = (await db.query(`select title from public.assignments where id = $1`, [rowA2])).rows[0]?.title;
  record('edit', 'an assignee cannot rewrite the task title', titleNow === 'Visit the new member',
    retitle.ok ? `returned ${retitle.rows.length}, title=${titleNow}` : retitle.error.slice(0, 90));

  // ─── Manager reopen and list ───────────────────────────────────────────────────────────────────────────────────────
  allowed('progress', 'an admin reopens a completed row',
    await attempt(db, 'authenticated', ADMIN, `update public.assignments set status = 'pending', reviewed_at = null where id = $1 returning id`, [rowA1]));
  const reopened = (await db.query(`select status, reviewed_at from public.assignments where id = $1`, [rowA1])).rows[0];
  record('progress', 'the reopened row is pending and unreviewed', reopened?.status === 'pending' && reopened?.reviewed_at === null);

  record('rows', 'the batch is still two rows after review and reopen', (await db.query(`select count(*)::int n from public.assignments where batch_id = $1`, [batch])).rows[0].n === 2);

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\nASSIGNMENTS CERTIFICATION: PASS ${pass}  FAIL ${fail}  total ${results.length}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('CERTIFICATION ABORTED:', e.message);
  process.exit(2);
});
