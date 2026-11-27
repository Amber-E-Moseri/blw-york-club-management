// Announcement notification scope (migration 069) on PGlite, full chain. No notification is sent: the functions are
// exercised for recipient resolution only. Positive and negative controls, direct RPC and table attempts, and the
// effect of removed and reassigned leaders.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/announcement_dispatch_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [dispatch069] ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const svc = (sql, params = []) => attempt(db, 'service_role', null, sql, params);
const owner = (sql, params = []) => db.query(sql, params);
const P = (n) => `fe000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: P(1), coord: P(2), leaderA: P(3), leaderB: P(4), newLeaderA: P(5), roleOnly: P(6), memberA1: P(7), memberA2: P(8), memberB: P(9), pendingA: P(10), inactiveA: P(11), rejectedA: P(12), noDevice: P(13) };
const CELL = { A: P(101), B: P(102), C: P(103) };
const ANN = { orgWide: P(201), cellA: P(202), cellB: P(203), cellC: P(204), cellAReassigned: P(205), coordCellB: P(206), releaseA: P(207) };

for (const [k, id] of Object.entries(U)) {
  await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.disp069@website.invalid`, `Test ${k}`]);
}
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
await owner(`update public.profiles set role='coordinator', status='active' where id=$1`, [U.coord]);
await owner(`update public.profiles set role='member', status='active' where id in ($1,$2,$3,$4,$5)`, [U.leaderA, U.leaderB, U.newLeaderA, U.memberA1, U.memberA2]);
await owner(`update public.profiles set role='member', status='active' where id in ($1,$2)`, [U.memberB, U.noDevice]);
await owner(`update public.profiles set role='cell_leader', status='active' where id=$1`, [U.roleOnly]);
await owner(`update public.profiles set role='member', status='pending' where id=$1`, [U.pendingA]);
await owner(`update public.profiles set role='member', status='inactive' where id=$1`, [U.inactiveA]);
await owner(`update public.profiles set role='member', status='rejected' where id=$1`, [U.rejectedA]);
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3,$4,$5,$6,$7)`, [CELL.A, U.leaderA, U.memberA1, U.memberA2, U.pendingA, U.inactiveA, U.rejectedA]);
await owner(`update public.profiles set cell_id=$1 where id in ($2,$3)`, [CELL.B, U.leaderB, U.memberB]);
await owner(`update public.profiles set cell_id=$1 where id=$2`, [CELL.C, U.noDevice]);
await owner(`update public.profiles set cell_id=$1 where id=$2`, [CELL.A, U.roleOnly]);
await owner(`insert into public.cells (id,name,leader_id) values ($1,'A',$2),($3,'B',$4),($5,'C',$6)`, [CELL.A, U.leaderA, CELL.B, U.leaderB, CELL.C, U.noDevice]);
await owner(`insert into public.announcements (id,title,body,author_id,author_name,cell_id) values
  ($1,'Org','All',$2,'Admin',null),
  ($3,'Cell A','A news',$4,'Leader A',$5),
  ($6,'Cell B','B news',$7,'Leader B',$8),
  ($9,'Cell C quiet','Quiet',$10,'Leader C',$11),
  ($12,'Cell A reassigned','Later',$4,'Leader A',$5),
  ($13,'Cell B coordinator','Coord',$7,'Leader B',$8),
  ($14,'Cell A release','Release',$4,'Leader A',$5)`,
  [ANN.orgWide, U.admin, ANN.cellA, U.leaderA, CELL.A, ANN.cellB, U.leaderB, CELL.B, ANN.cellC, U.noDevice, CELL.C, ANN.cellAReassigned, ANN.coordCellB, ANN.releaseA]);

// Devices: active members of A have active devices, plus one inactive device. B has a device. Pending, inactive and
// rejected profiles have active devices (must never be delivered). noDevice has no subscription at all.
const devices = [
  [U.memberA1, 'a1'], [U.memberA2, 'a2'], [U.leaderA, 'la'], [U.memberB, 'b1'], [U.leaderB, 'lb'], [U.roleOnly, 'ro'],
  [U.pendingA, 'pa'], [U.inactiveA, 'ia'], [U.rejectedA, 'ra'], [U.admin, 'ad'], [U.coord, 'co'], [U.newLeaderA, 'nla'],
];
for (const [uid, tag] of devices) {
  await owner(`insert into public.push_subscriptions (user_id,endpoint,p256dh,auth,is_active) values ($1,$2,'k','a',true)`, [uid, `https://push.invalid/${tag}`]);
}
await owner(`insert into public.push_subscriptions (user_id,endpoint,p256dh,auth,is_active) values ($1,'https://push.invalid/a1-off','k','a',false)`, [U.memberA1]);

const claim = (actor, ann) => svc(`select public.claim_announcement_dispatch($1,$2) as ok`, [ann, actor]);
const resolve = (actor, ann) => svc(`select user_id, endpoint from public.resolve_announcement_recipients($1,$2)`, [ann, actor]);
const recipientsOf = (r) => (r.rows ?? []).map((x) => x.endpoint).sort();

// ── Positive: own-cell delivery ──────────────────────────────────────────────────────────────────────────────────────
let r = await claim(U.leaderA, ANN.cellA);
check('an assigned leader claims a dispatch for their own cell', r.ok && r.rows[0].ok === true, r.error);
r = await resolve(U.leaderA, ANN.cellA);
const expectedA = ['https://push.invalid/a1', 'https://push.invalid/a2', 'https://push.invalid/la', 'https://push.invalid/ro'].sort();
check('own-cell recipients are exactly the active members of that cell with active devices', r.ok && JSON.stringify(recipientsOf(r)) === JSON.stringify(expectedA), recipientsOf(r).join(','));

// ── Duplicate suppression ────────────────────────────────────────────────────────────────────────────────────────────
r = await claim(U.leaderA, ANN.cellA);
check('a second claim for the same announcement is refused (no second dispatch)', r.ok && r.rows[0].ok === false, r.error ?? JSON.stringify(r.rows));
r = await claim(U.admin, ANN.cellA);
check('a staff member cannot re-claim an already dispatched announcement', r.ok && r.rows[0].ok === false, r.error ?? JSON.stringify(r.rows));
const claimCount = (await owner(`select count(*)::int n from public.announcement_dispatches where announcement_id=$1`, [ANN.cellA])).rows[0].n;
check('exactly one dispatch row exists per announcement after repeated claims', claimCount === 1, claimCount);

// ── Organization-wide: staff only ────────────────────────────────────────────────────────────────────────────────────
r = await claim(U.leaderA, ANN.orgWide);
check('negative: a cell leader cannot claim an organization-wide announcement', !r.ok && /42501|not authorised/.test(r.error ?? ''), r.ok ? 'claimed' : r.error);
r = await claim(U.roleOnly, ANN.orgWide);
check('negative: a cell_leader-role account without an assignment cannot claim organization-wide', !r.ok, r.ok ? 'claimed' : r.error);
r = await claim(U.admin, ANN.orgWide);
check('an administrator claims an organization-wide announcement', r.ok && r.rows[0].ok === true, r.error);
r = await resolve(U.admin, ANN.orgWide);
const everyActive = ['https://push.invalid/a1', 'https://push.invalid/a2', 'https://push.invalid/la', 'https://push.invalid/b1', 'https://push.invalid/lb', 'https://push.invalid/ro', 'https://push.invalid/ad', 'https://push.invalid/co', 'https://push.invalid/nla'].sort();
check('organization-wide recipients are all active members with active devices, never pending/inactive/rejected', r.ok && JSON.stringify(recipientsOf(r)) === JSON.stringify(everyActive), recipientsOf(r).join(','));
r = await claim(U.coord, ANN.coordCellB);
check('a coordinator claims a cell announcement in any cell', r.ok && r.rows[0].ok === true, r.error);

// ── Cross-cell refusal ───────────────────────────────────────────────────────────────────────────────────────────────
r = await claim(U.leaderA, ANN.cellB);
check('negative: a leader of cell A cannot claim a cell B announcement', !r.ok, r.ok ? 'claimed' : r.error);
r = await resolve(U.leaderA, ANN.cellB);
check('negative: a leader of cell A cannot resolve recipients for cell B', !r.ok, r.ok ? recipientsOf(r).join(',') : r.error);
r = await claim(U.leaderB, ANN.cellB);
check('the cell B leader claims cell B', r.ok && r.rows[0].ok === true, r.error);
const bOnly = await resolve(U.leaderB, ANN.cellB);
check('no delivery to unrelated cells: cell B dispatch never includes cell A devices', bOnly.ok && !recipientsOf(bOnly).some((e) => e.includes('/a1') || e.includes('/a2') || e.includes('/la')), recipientsOf(bOnly).join(','));

// ── Role-only leader and pending/inactive actors ─────────────────────────────────────────────────────────────────────
r = await claim(U.roleOnly, ANN.cellA);
check('negative: a role-only cell_leader cannot claim even a cell announcement in their profile cell', !r.ok, r.ok ? 'claimed' : r.error);
r = await claim(U.pendingA, ANN.cellA);
check('negative: a pending member cannot claim', !r.ok, r.ok ? 'claimed' : r.error);
r = await claim(U.inactiveA, ANN.cellA);
check('negative: an inactive member cannot claim', !r.ok, r.ok ? 'claimed' : r.error);

// ── Zero-recipient announcement: claimed once, nothing to send, no later re-dispatch when devices appear ──────────
r = await claim(U.noDevice, ANN.cellC);
check('a zero-recipient announcement is claimed', r.ok && r.rows[0].ok === true, r.error);
r = await resolve(U.noDevice, ANN.cellC);
check('zero-recipient resolution returns no devices', r.ok && r.rows.length === 0, r.rows?.length);
await owner(`insert into public.push_subscriptions (user_id,endpoint,p256dh,auth,is_active) values ($1,'https://push.invalid/nc','k','a',true)`, [U.noDevice]);
r = await claim(U.noDevice, ANN.cellC);
check('a later notify after a device appears does not re-dispatch', r.ok && r.rows[0].ok === false, r.error ?? JSON.stringify(r.rows));

// ── Removed and reassigned leader ───────────────────────────────────────────────────────────────────────────────────
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.newLeaderA, CELL.A]);
r = await claim(U.leaderA, ANN.cellAReassigned);
check('negative: a removed leader (reassigned away) cannot claim a dispatch for the cell', !r.ok, r.ok ? 'claimed' : r.error);
r = await claim(U.newLeaderA, ANN.cellAReassigned);
check('the reassigned-in leader claims the cell dispatch', r.ok && r.rows[0].ok === true, r.error);
r = await resolve(U.newLeaderA, ANN.cellAReassigned);
check('the reassigned-in leader receives the same cell-scoped recipient set', r.ok && JSON.stringify(recipientsOf(r)) === JSON.stringify(expectedA), recipientsOf(r).join(','));
await owner(`update public.cells set leader_id=null where id=$1`, [CELL.A]);
const newCell = await claim(U.newLeaderA, ANN.cellA);
check('a leader with no cell (leadership removed) cannot claim', !newCell.ok || newCell.rows[0].ok === false, newCell.error ?? JSON.stringify(newCell.rows));

// ── Resolution requires the claim ─────────────────────────────────────────────────────────────────────────────────────
r = await resolve(U.admin, ANN.cellC);
check('negative: resolving recipients without holding the claim is refused', !r.ok, r.ok ? recipientsOf(r).join(',') : r.error);

// ── Release: only the claiming actor, and it reopens the claim for a retry ────────────────────────────────────────────
await owner(`update public.cells set leader_id=$1 where id=$2`, [U.leaderA, CELL.A]);
await claim(U.leaderA, ANN.releaseA);
r = await svc(`select public.release_announcement_dispatch($1,$2)`, [ANN.releaseA, U.coord]);
const stillClaimed = (await owner(`select count(*)::int n from public.announcement_dispatches where announcement_id=$1`, [ANN.releaseA])).rows[0].n;
check('negative: a different actor cannot release another actor’s claim', stillClaimed === 1, stillClaimed);
await svc(`select public.release_announcement_dispatch($1,$2)`, [ANN.releaseA, U.leaderA]);
r = await claim(U.leaderA, ANN.releaseA);
check('after a pre-send failure the claimant releases and a retry can claim', r.ok && r.rows[0].ok === true, r.error);

// ── Direct API and RPC attempts by ordinary members ───────────────────────────────────────────────────────────────────
r = await as(U.memberA1, `select user_id from public.resolve_announcement_recipients($1,$2)`, [ANN.cellA, U.memberA1]);
check('direct RPC: an ordinary member cannot call resolve_announcement_recipients', !r.ok, r.ok ? 'returned rows' : r.error);
r = await as(U.memberA1, `select public.claim_announcement_dispatch($1,$2)`, [ANN.cellA, U.memberA1]);
check('direct RPC: an ordinary member cannot call claim_announcement_dispatch', !r.ok, r.ok ? 'executed' : r.error);
r = await as(U.memberA1, `select public.release_announcement_dispatch($1,$2)`, [ANN.cellA, U.memberA1]);
check('direct RPC: an ordinary member cannot call release_announcement_dispatch', !r.ok, r.ok ? 'executed' : r.error);
r = await as(U.admin, `select public.claim_announcement_dispatch($1,$2)`, [ANN.cellA, U.admin]);
check('direct RPC: an administrator cannot bypass the service-only boundary (authenticated execute revoked)', !r.ok, r.ok ? 'executed' : r.error);
r = await as(U.admin, `select * from public.announcement_dispatches`);
check('direct table: no authenticated role can read dispatch claims', !r.ok, r.ok ? 'read' : r.error);
r = await as(null, `select public.claim_announcement_dispatch($1,$2)`, [ANN.cellA, U.leaderA], 'anon');
check('direct RPC: anonymous callers cannot claim', !r.ok, r.ok ? 'executed' : r.error);

// ── Lifecycle (071): claimed -> sending -> completed | partial; partial is never reported as complete ────────────────────
const LIFE = { partial: P(208), completed: P(209), stuck: P(210), beforeSend: P(211) };
await owner(`insert into public.announcements (id,title,body,author_id,author_name,cell_id) values
  ($1,'Lifecycle partial','x',$4,'Leader A',$5),($2,'Lifecycle complete','x',$4,'Leader A',$5),($3,'Lifecycle stuck','x',$4,'Leader A',$5),($6,'Lifecycle early','x',$4,'Leader A',$5)`,
  [LIFE.partial, LIFE.completed, LIFE.stuck, U.leaderA, CELL.A, LIFE.beforeSend]);
const lifeStatus = async (ann) => (await owner(`select status, sent_count, failed_count from public.announcement_dispatches where announcement_id=$1`, [ann])).rows[0];
await claim(U.leaderA, LIFE.partial);
r = await svc(`select public.begin_announcement_send($1,$2) ok`, [LIFE.partial, U.leaderA]);
check('a claimed dispatch moves to sending before the first push', r.ok && r.rows[0].ok === true && (await lifeStatus(LIFE.partial)).status === 'sending', r.error);
r = await svc(`select public.release_announcement_dispatch($1,$2)`, [LIFE.partial, U.leaderA]);
check('negative: a dispatch that is sending cannot be released (no second broadcast after pushes began)', (await lifeStatus(LIFE.partial))?.status === 'sending', JSON.stringify(await lifeStatus(LIFE.partial)));
r = await svc(`select public.complete_announcement_dispatch($1,$2,2,1) st`, [LIFE.partial, U.leaderA]);
check('partial delivery is recorded as partial, with counts, never as complete', r.ok && r.rows[0].st === 'partial' && (await lifeStatus(LIFE.partial)).failed_count === 1, r.error ?? JSON.stringify(r.rows));
r = await claim(U.leaderA, LIFE.partial);
check('a partial dispatch is not re-broadcast automatically (a second claim is refused)', r.ok && r.rows[0].ok === false, r.error ?? JSON.stringify(r.rows));
r = await as(U.admin, `select announcement_id, status from public.v_announcement_dispatch_attention`);
check('staff see partial deliveries for review', r.ok && r.rows.some((x) => x.announcement_id === LIFE.partial && x.status === 'partial'), r.error ?? JSON.stringify(r.rows));
r = await as(U.memberA1, `select announcement_id from public.v_announcement_dispatch_attention`);
check('negative: ordinary members see no dispatch attention rows', r.ok && r.rows.length === 0, r.error ?? r.rows.length);

await claim(U.leaderA, LIFE.completed);
await svc(`select public.begin_announcement_send($1,$2)`, [LIFE.completed, U.leaderA]);
r = await svc(`select public.complete_announcement_dispatch($1,$2,2,0) st`, [LIFE.completed, U.leaderA]);
check('a fully successful dispatch is completed', r.ok && r.rows[0].st === 'completed', r.error);

await claim(U.leaderA, LIFE.stuck);
await svc(`select public.begin_announcement_send($1,$2)`, [LIFE.stuck, U.leaderA]);
await owner(`update public.announcement_dispatches set sending_at = now() - interval '1 hour' where announcement_id=$1`, [LIFE.stuck]);
r = await as(U.admin, `select announcement_id, status from public.v_announcement_dispatch_attention`);
check('a delivery left in sending by a terminated process is reported for review, not retried', r.ok && r.rows.some((x) => x.announcement_id === LIFE.stuck && x.status === 'sending'), r.error ?? JSON.stringify(r.rows));
r = await claim(U.leaderA, LIFE.stuck);
check('a stuck sending dispatch is not re-claimed automatically', r.ok && r.rows[0].ok === false, r.error);

await claim(U.leaderA, LIFE.beforeSend);
r = await svc(`select public.complete_announcement_dispatch($1,$2,1,0) st`, [LIFE.beforeSend, U.leaderA, 1, 0]);
check('negative: completion without a begun send is refused', !r.ok, r.ok ? 'completed' : r.error);
r = await svc(`select public.release_announcement_dispatch($1,$2)`, [LIFE.beforeSend, U.leaderA]);
check('a claim that never began sending can be released before any push', (await owner(`select count(*)::int n from public.announcement_dispatches where announcement_id=$1`, [LIFE.beforeSend])).rows[0].n === 0);

// ── Authority helper is not callable directly by clients ─────────────────────────────────────────────────────────────
r = await as(U.leaderA, `select public.announcement_dispatch_authorised($1,$2)`, [ANN.cellA, U.leaderA]);
check('the authority helper is not executable by authenticated clients', !r.ok, r.ok ? 'executed' : r.error);

const failed = results.filter((x) => !x).length;
console.log(`\nANNOUNCEMENT DISPATCH 069 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
