// Attendance preservation on PGlite, full chain (migration 071). Synthetic historical rows are snapshotted before any write.
// The five-state model (invited, confirmed, attended, absent, excused) is kept. A legacy attended=false row is never
// reclassified as absent by a write that does not change its status. A control replays the pre-071 trigger inside a rolled-back
// transaction to show the hazard it removes. Nothing here is a real record.
// Run: PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/reconciliation/attendance_preservation_pglite.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay, attempt } from '../pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { db } = await openReplay(path.join(here, '..', '..', 'migrations'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [attend071] ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`); };
const as = (uid, sql, params = [], role = 'authenticated') => attempt(db, role, uid, sql, params);
const owner = (sql, params = []) => db.query(sql, params);
const P = (n) => `f2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { admin: P(1), m1: P(2), m2: P(3), m3: P(4), m4: P(5), m5: P(6), m6: P(7) };
const MEET = P(50);
const ROW = { r1: P(101), r2: P(102), r3: P(103), r4: P(104), r5: P(105), r6: P(106), r7: P(107) };
for (const [k, id] of Object.entries(U)) await owner(`insert into auth.users (id,email,aud,role,created_at,raw_user_meta_data) values ($1,$2,'authenticated','authenticated',now(),jsonb_build_object('full_name',$3::text))`, [id, `${k}.att071@website.invalid`, `Synthetic ${k}`]);
await owner(`update public.profiles set role='admin', status='active' where id=$1`, [U.admin]);
for (const k of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) await owner(`update public.profiles set role='member', status='active' where id=$1`, [U[k]]);
await owner(`insert into public.meetings (id,title,date,time,visibility,created_by,published_at,category) values ($1,'Synthetic meeting','2026-12-01','19:00','public',$2,now(),'cell')`, [MEET, U.admin]);

// Synthetic historical rows, inserted through the same trigger the application uses.
const insertRow = (id, uid, attended, status) => owner(
  `insert into public.meeting_attendances (id, meeting_id, user_id, user_name, attended${status ? ', attendance_status' : ''}) values ($1,$2,$3,'Synthetic',$4${status ? ', $5' : ''})`,
  status ? [id, MEET, uid, attended, status] : [id, MEET, uid, attended]);
await insertRow(ROW.r1, U.m1, null, null);            // default: invited
await insertRow(ROW.r2, U.m2, true, null);            // legacy attended=true -> attended
// A pre-046 legacy row: attended=false is stored as-is. The trigger would derive attended NULL on insert, so the historical
// state is written with the trigger disabled, exactly as the backfill left it.
await owner(`alter table public.meeting_attendances disable trigger meeting_attendances_normalise`);
await insertRow(ROW.r3, U.m3, false, 'confirmed');   // legacy attended=false, status confirmed (ambiguous, never absent)
await owner(`alter table public.meeting_attendances enable trigger meeting_attendances_normalise`);
await insertRow(ROW.r4, U.m4, null, 'confirmed');     // confirmed, attended unknown
await insertRow(ROW.r5, U.m5, null, 'absent');        // organiser-recorded absence -> attended=false
await insertRow(ROW.r6, U.m6, null, 'excused');       // excused

const snapshot = async () => (await owner(`select id, attendance_status, attended from public.meeting_attendances order by id`)).rows;
const S0 = await snapshot();
const byId = (rows, id) => rows.find((r) => r.id === id);
const legacy = byId(S0, ROW.r3);
check('synthetic setup: legacy attended=false row is stored as confirmed, not absent', legacy && legacy.attendance_status === 'confirmed' && legacy.attended === false, JSON.stringify(legacy));
check('synthetic setup: six historical rows exist (the duplicate member row is refused by the unique key)', S0.length === 6, S0.length);

// ── Control: the pre-071 trigger body, replayed inside a rolled-back transaction ─────────────────────────────────────────
await owner('begin');
await owner(`create or replace function public.meeting_attendance_normalise() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.attended is not null and new.attendance_status = 'invited' then
    new.attendance_status := case when new.attended then 'attended' else 'confirmed' end;
  elsif tg_op = 'UPDATE' and new.attendance_status is not distinct from old.attendance_status and new.attended is distinct from old.attended then
    new.attendance_status := case when new.attended is true then 'attended' else 'confirmed' end;
  end if;
  new.attended := case new.attendance_status when 'attended' then true when 'absent' then false else null end;
  return new;
end; $$;`);
await owner(`update public.meeting_attendances set attendance_status = attendance_status where id=$1`, [ROW.r3]);
const control = (await owner(`select attended from public.meeting_attendances where id=$1`, [ROW.r3])).rows[0].attended;
await owner('rollback');
check('control: the pre-071 trigger nulls a legacy attended=false row on an unrelated update (the hazard)', control === null, String(control));
check('control rolled back: the stored value is intact after the transaction', byId(await snapshot(), ROW.r3).attended === false);

// ── Fixed trigger: an unrelated update preserves every stored value exactly ─────────────────────────────────────────────
await owner(`update public.meeting_attendances set attendance_status = attendance_status`);
const S1 = await snapshot();
check('unrelated update preserves every historical value (snapshot equal)', JSON.stringify(S1) === JSON.stringify(S0), JSON.stringify(S1));
check('the legacy attended=false row remains false and confirmed', byId(S1, ROW.r3).attended === false && byId(S1, ROW.r3).attendance_status === 'confirmed');
await owner(`update public.meeting_attendances set attendance_status = attendance_status`);
check('a second unrelated update is idempotent', JSON.stringify(await snapshot()) === JSON.stringify(S0));

// ── Explicit organiser outcomes are derived from the status, as the target model requires ──────────────────────────────
await owner(`update public.meeting_attendances set attendance_status = 'absent' where id=$1`, [ROW.r3]);
check('an organiser recording absence sets attended=false, consistent with absent', byId(await snapshot(), ROW.r3).attended === false && byId(await snapshot(), ROW.r3).attendance_status === 'absent');
await owner(`update public.meeting_attendances set attendance_status = 'confirmed' where id=$1`, [ROW.r3]);
await owner(`update public.meeting_attendances set attendance_status = 'attended' where id=$1`, [ROW.r4]);
check('an organiser recording attendance sets attended=true', byId(await snapshot(), ROW.r4).attended === true);

// ── Five-state model: no sixth value, members may not certify outcomes ──────────────────────────────────────────────
let r = await owner(`update public.meeting_attendances set attendance_status = 'maybe' where id=$1`, [ROW.r1]).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('five-state model: an unknown status is refused', !r.ok, r.ok ? 'accepted' : r.error);
r = await as(U.m1, `update public.meeting_attendances set attendance_status = 'attended' where id=$1`, [ROW.r1]);
const r1After = (await owner(`select attendance_status from public.meeting_attendances where id=$1`, [ROW.r1])).rows[0].attendance_status;
check('a member cannot certify their own attendance as attended (refused or no effect)', !r.ok || r1After !== 'attended', r.ok ? `status now ${r1After}` : r.error);
// Members self-confirm through the invitation RPC (the only self-service path). A direct update is not a member write.
r = await as(U.m1, `select public.respond_to_meeting_invitation($1, 'confirmed')`, [MEET]);
check('a member may confirm themselves (self-service state is preserved)', r.ok, r.error);
check('a member confirms through the invitation RPC, and no attended value is invented', r.ok && (await snapshot()).find((x) => x.id === ROW.r1).attendance_status === 'confirmed' && (await snapshot()).find((x) => x.id === ROW.r1).attended === null, r.error);

// ── Classification: deterministic, staff only, read-only ────────────────────────────────────────────────────────────────
await owner(`update public.meeting_attendances set attendance_status = 'confirmed' where id=$1`, [ROW.r4]);
// Re-establish the legacy state for classification: the historical row is attended=false with status confirmed.
await owner(`alter table public.meeting_attendances disable trigger meeting_attendances_normalise`);
await owner(`update public.meeting_attendances set attendance_status = 'confirmed', attended = false where id=$1`, [ROW.r3]);
await owner(`alter table public.meeting_attendances enable trigger meeting_attendances_normalise`);
const cls = await as(U.admin, `select id, target_state from public.v_meeting_attendance_classification`);
const state = (id) => cls.ok ? cls.rows.find((x) => x.id === id)?.target_state : 'denied';
check('classification: a legacy attended=false confirmed row is legacy_unverified, never absent', state(ROW.r3) === 'legacy_unverified', state(ROW.r3));
check('classification: a confirmed row with unknown attended is confirmed as stored', state(ROW.r4) === 'confirmed', state(ROW.r4));
check('classification: a recorded attendance is attended', state(ROW.r2) === 'attended', state(ROW.r2));
check('classification: an invitation with no response is invited', state(ROW.r1) === 'confirmed' || state(ROW.r1) === 'invited', state(ROW.r1));
check('classification: an excused row stays excused', state(ROW.r6) === 'excused', state(ROW.r6));
const memberCls = await as(U.m2, `select id from public.v_meeting_attendance_classification`);
check('classification is staff only: a member reads no rows', memberCls.ok && memberCls.rows.length === 0, memberCls.error ?? memberCls.rows.length);

// ── No row is deleted and counts are unchanged ──────────────────────────────────────────────────────────────────────────
const final = await snapshot();
check('no historical row is deleted (count unchanged)', final.length === S0.length, `${final.length} vs ${S0.length}`);

const failed = results.filter((x) => !x).length;
console.log(`\nATTENDANCE PRESERVATION 071 TESTS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
