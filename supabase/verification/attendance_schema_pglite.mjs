// Attendance schema evidence for remediation Wave 5, run on PGlite against the main migration chain (000 .. 044).
//
// What this records, and what it does NOT decide:
//   * On main, meeting_attendances has the legacy boolean `attended` (migration 009) and no `attendance_status`.
//   * The attendance state model (invited / confirmed / attended / absent / excused) with `attendance_status` as the
//     source of truth is defined by migration 074 on the integration lineage (integ/authoritative-104-105, and others),
//     which depends on migrations that are not on main. It is not added here.
//   * The UI and src/lib/queries/meetings.ts write and read `attendance_status`. Against the main schema those
//     statements fail. This script proves that, and checks that the legacy `attended` path still works.
//
// The checks assert the CURRENT main schema. If a later change adds `attendance_status` to main, check 1 fails on
// purpose, so the attendance model is reviewed before the change lands.
//
// Usage (PGlite must be installed outside the repo):
//   PGLITE_MODULE=file:///<path>/node_modules/@electric-sql/pglite/dist/index.js node supabase/verification/attendance_schema_pglite.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
}

async function statementError(db, sql) {
  try {
    await db.query(sql);
    return null;
  } catch (e) {
    return { code: e.code, message: e.message };
  }
}

async function run() {
  const { db } = await openReplay(MIGRATIONS, { lastFile: null });

  const cols = await db.query(
    `select column_name, data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'meeting_attendances' order by ordinal_position`,
  );
  const names = cols.rows.map((r) => r.column_name);
  const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r.data_type]));
  console.log(`meeting_attendances columns on main: ${names.join(', ')}`);

  check(
    '1. attendance_status is absent on the main chain (schema defined by 074, not on main)',
    !('attendance_status' in byName),
    `present=${'attendance_status' in byName}`,
  );

  check(
    '2. legacy attended column exists as boolean (migration 009)',
    byName.attended === 'boolean',
    `attended type=${byName.attended ?? 'missing'}`,
  );

  const readAttended = await statementError(db, 'select attended from public.meeting_attendances limit 0');
  check('3. read of attended succeeds', readAttended === null, JSON.stringify(readAttended));

  const writeAttended = await statementError(
    db,
    'update public.meeting_attendances set attended = true where false',
  );
  check('4. write of attended succeeds', writeAttended === null, JSON.stringify(writeAttended));

  // These are the statements src/lib/queries/meetings.ts issues. Expected to fail on main until the model is decided.
  const readStatus = await statementError(db, 'select attendance_status from public.meeting_attendances limit 0');
  check(
    '5. read of attendance_status fails on main (42703 undefined_column; meetings.ts fetchMeetings)',
    readStatus !== null && readStatus.code === '42703',
    JSON.stringify(readStatus),
  );

  const writeStatus = await statementError(
    db,
    "update public.meeting_attendances set attendance_status = 'attended' where false",
  );
  check(
    '6. write of attendance_status fails on main (42703; meetings.ts markAttended and markAttendanceStatus)',
    writeStatus !== null && writeStatus.code === '42703',
    JSON.stringify(writeStatus),
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ${r.detail}`}`);
  }
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
  console.log(
    'Note: checks 5 and 6 document the defect. They pass while the schema and the client disagree.',
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}

run().catch((err) => {
  console.error('ERROR', err);
  process.exitCode = 2;
});
