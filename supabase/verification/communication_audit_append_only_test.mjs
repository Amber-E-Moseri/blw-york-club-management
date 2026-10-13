// communication_audit append-only tests (migration 087), run on PGlite.
//
// After 087, communication_audit is written by two legitimate paths and by nothing else:
//   1. send_message (SECURITY DEFINER, owner) inserts action = 'send';
//   2. dispatch-message (Edge Function, service_role) inserts action = 'dispatch' before any provider is called.
// service_role keeps INSERT only. No role may change or remove an audit row, including the owner (trigger guard).
//
// This replays the migrations, then checks:
//   1. positive controls: the send path still writes its audit row, and the service_role dispatch insert still works;
//   2. negative controls: service_role cannot UPDATE, DELETE, TRUNCATE or SELECT; authenticated and anon cannot change
//      the table; the owner cannot UPDATE, DELETE or TRUNCATE (the guard trigger refuses); deleting a message that has
//      audit rows is refused; the seeded rows are unchanged after every attempt.
//
// Set AUDIT_TEST_LAST=086_audit_tables_no_service_access.sql to run the same negative checks on the frozen sequence.
// They must FAIL there, which proves the finding.
//
// Limits: PGlite is not a Supabase stack. This certifies the SQL grants, triggers and definer paths, not the Auth or
// PostgREST layer. The Edge Function path is also certified in the real-stack suite.
//
// Usage:
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/communication_audit_append_only_test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
const LAST = process.env.AUDIT_TEST_LAST ?? '087_communication_audit_append_only.sql';

const results = [];
const check = (name, ok, evidence = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  [${String(evidence).slice(0, 140)}]` : ''}`);
};
const denied = (r) => !r.ok && r.code === '42501';

const { db, applied } = await openReplay(MIGRATIONS, { lastFile: LAST });
console.log(`replayed ${applied.length} migrations through ${applied[applied.length - 1]}`);

const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

// ─── fixtures (owner bypasses RLS) ──────────────────────────────────────────
const people = { coordinator: 'coordinator', member: 'member' };
const ids = {};
for (const [label, role] of Object.entries(people)) {
  ids[label] = crypto.randomUUID();
  await db.query('insert into auth.users (id, email, aud, role, created_at) values ($1, $2, $3, $4, now())',
    [ids[label], `${label}@test.example`, 'authenticated', 'authenticated']);
  await db.query('update public.profiles set full_name = $2, role = $3, status = $4 where id = $1',
    [ids[label], label, role, 'active']);
}

const coordCtx = ['authenticated', ids.coordinator];

// ─── 1. positive controls ──────────────────────────────────────────────────
const sendKey = crypto.randomUUID();
const send = await attempt(db, ...coordCtx,
  "select public.send_message('Hello', 'Body', 'explicit', null, null, $1::uuid[], array['inbox']::text[], $2::uuid) as id",
  [`{${ids.member}}`, sendKey]);
const messageId = send.ok ? send.rows[0].id : null;
check('positive: coordinator send_message still writes one send audit row',
  send.ok && (await count("select count(*)::int n from public.communication_audit where message_id = $1 and action = 'send'", [messageId])) === 1,
  send.error);

const dispatchInsert = await attempt(db, 'service_role', null,
  `insert into public.communication_audit (message_id, actor_id, actor_role, action, audience_mode, recipient_count)
   values ($1, $2, 'coordinator', 'dispatch', 'explicit', 1)`, [messageId, ids.coordinator]);
check('positive: service_role dispatch insert (the Edge Function path) still succeeds',
  dispatchInsert.ok && (await count("select count(*)::int n from public.communication_audit where message_id = $1 and action = 'dispatch'", [messageId])) === 1,
  dispatchInsert.error);

// ─── 2. negative controls ──────────────────────────────────────────────────
// Seed a known audit row as owner, then let every role try to change or remove it.
const seedId = (await db.query(
  "select id from public.communication_audit where message_id = $1 and action = 'send'", [messageId])).rows[0].id;
const snapshot = () => count('select count(*)::int n from public.communication_audit where id = $1 and recipient_count = 1', [seedId]);
const before = await snapshot();

const svcUpdate = await attempt(db, 'service_role', null, 'update public.communication_audit set recipient_count = 0 where id = $1', [seedId]);
check('negative: service_role cannot UPDATE an audit row', denied(svcUpdate), svcUpdate.ok ? 'statement succeeded' : `${svcUpdate.code} ${svcUpdate.error}`);
const svcDelete = await attempt(db, 'service_role', null, 'delete from public.communication_audit where id = $1', [seedId]);
check('negative: service_role cannot DELETE an audit row', denied(svcDelete), svcDelete.ok ? 'statement succeeded' : `${svcDelete.code} ${svcDelete.error}`);
const svcTruncate = await attempt(db, 'service_role', null, 'truncate public.communication_audit');
check('negative: service_role cannot TRUNCATE the audit table', denied(svcTruncate), svcTruncate.ok ? 'statement succeeded' : `${svcTruncate.code} ${svcTruncate.error}`);
const svcSelect = await attempt(db, 'service_role', null, 'select count(*) from public.communication_audit');
check('negative: service_role cannot SELECT the audit table', denied(svcSelect), svcSelect.ok ? 'statement succeeded' : `${svcSelect.code} ${svcSelect.error}`);

const authUpdate = await attempt(db, ...coordCtx, 'update public.communication_audit set recipient_count = 0 where id = $1', [seedId]);
check('negative: authenticated coordinator cannot UPDATE an audit row', denied(authUpdate), authUpdate.ok ? 'statement succeeded' : `${authUpdate.code} ${authUpdate.error}`);
const authDelete = await attempt(db, ...coordCtx, 'delete from public.communication_audit where id = $1', [seedId]);
check('negative: authenticated coordinator cannot DELETE an audit row', denied(authDelete), authDelete.ok ? 'statement succeeded' : `${authDelete.code} ${authDelete.error}`);
const authInsert = await attempt(db, ...coordCtx,
  `insert into public.communication_audit (message_id, actor_id, actor_role, action, audience_mode, recipient_count)
   values ($1, $2, 'coordinator', 'send', 'explicit', 1)`, [messageId, ids.coordinator]);
check('negative: authenticated coordinator cannot INSERT an audit row directly', denied(authInsert), authInsert.ok ? 'statement succeeded' : `${authInsert.code} ${authInsert.error}`);

const anonUpdate = await attempt(db, 'anon', null, 'update public.communication_audit set recipient_count = 0 where id = $1', [seedId]);
check('negative: anon cannot UPDATE an audit row', denied(anonUpdate), anonUpdate.ok ? 'statement succeeded' : `${anonUpdate.code} ${anonUpdate.error}`);

const ownerUpdate = await attempt(db, 'owner', null, 'update public.communication_audit set recipient_count = 0 where id = $1', [seedId]);
check('negative: the owner cannot UPDATE an audit row (guard trigger)', denied(ownerUpdate), ownerUpdate.ok ? 'statement succeeded' : `${ownerUpdate.code} ${ownerUpdate.error}`);
const ownerDelete = await attempt(db, 'owner', null, 'delete from public.communication_audit where id = $1', [seedId]);
check('negative: the owner cannot DELETE an audit row (guard trigger)', denied(ownerDelete), ownerDelete.ok ? 'statement succeeded' : `${ownerDelete.code} ${ownerDelete.error}`);
const ownerTruncate = await attempt(db, 'owner', null, 'truncate public.communication_audit');
check('negative: the owner cannot TRUNCATE the audit table (guard trigger)', denied(ownerTruncate), ownerTruncate.ok ? 'statement succeeded' : `${ownerTruncate.code} ${ownerTruncate.error}`);

const deleteMessage = await attempt(db, 'owner', null, 'delete from public.communication_messages where id = $1', [messageId]);
check('negative: deleting a message that has audit rows is refused (cascade blocked)', denied(deleteMessage),
  deleteMessage.ok ? 'statement succeeded' : `${deleteMessage.code} ${deleteMessage.error}`);

const after = await snapshot();
check('the seeded audit row is unchanged after every attempt', before === 1 && after === 1, `before=${before} after=${after}`);

// ─── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((r) => r.name).join('; '));
  process.exit(1);
}
