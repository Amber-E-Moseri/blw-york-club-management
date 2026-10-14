// Regression: the fingerprint must detect a change of a policy's permissive/restrictive mode (migration 074 made
// meetings_publication_gate RESTRICTIVE). Runs on PGlite (no Docker): replays 000–086, fingerprints, flips the mode
// to PERMISSIVE, fingerprints again, and requires the contract checker's --same-as comparison to FAIL.
//
// Usage (from the repository root):
//   PGLITE_MODULE=file:///path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node supabase/verification/policy_mode_regression_test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openReplay } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
const FINGERPRINT_SQL = fs.readFileSync(path.join(here, 'schema_fingerprint.sql'), 'utf8');
const CHECKER = path.join(here, 'check_schema_contract.mjs');
const results = [];
const check = (name, ok, evidence = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  [${String(evidence).slice(0, 160)}]` : ''}`);
};

const { db } = await openReplay(MIGRATIONS, { lastFile: '086_audit_tables_no_service_access.sql' });
const fingerprint = async () => {
  // The fingerprint is a multi-statement script (a prepared query cannot run it); the last result holds the JSON row.
  const results = await db.exec(FINGERPRINT_SQL);
  const r = results[results.length - 1];
  const v = Object.values(r.rows[0])[0];
  return typeof v === "string" ? JSON.parse(v) : v;
};

const before = await fingerprint();
const gate = before.tables.meetings.policies.filter((p) => p.startsWith('meetings_publication_gate | '));
check('meetings_publication_gate is recorded as RESTRICTIVE before the change',
  gate.length === 1 && gate[0].endsWith(' | RESTRICTIVE'), gate[0]);

// Flip the mode by recreating the policy with the same command, roles and predicate, but PERMISSIVE.
const { rows: [{ qual }] } = await db.query(
  "select qual from pg_policies where schemaname = 'public' and tablename = 'meetings' and policyname = 'meetings_publication_gate'");
await db.exec(`drop policy meetings_publication_gate on public.meetings;
  create policy meetings_publication_gate on public.meetings as permissive for select to authenticated using (${qual});`);

const after = await fingerprint();
const gateAfter = after.tables.meetings.policies.filter((p) => p.startsWith('meetings_publication_gate | '));
check('the flipped policy is recorded as PERMISSIVE', gateAfter.length === 1 && gateAfter[0].endsWith(' | PERMISSIVE'), gateAfter[0]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-mode-'));
const a = path.join(dir, 'before.json');
const b = path.join(dir, 'after.json');
fs.writeFileSync(a, JSON.stringify(before));
fs.writeFileSync(b, JSON.stringify(after));
let sameAsOutput = '';
let sameAsCode = 0;
try {
  sameAsOutput = execFileSync(process.execPath, [CHECKER, b, '--same-as', a], { encoding: 'utf8' });
} catch (e) {
  sameAsCode = e.status ?? 1;
  sameAsOutput = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}
check('the contract checker --same-as reports a mismatch after the mode flip', sameAsCode !== 0 && /FAIL/.test(sameAsOutput),
  sameAsOutput.split('\n').filter((l) => /FAIL|PASS/.test(l)).slice(0, 2).join(' || '));
check('the mode flip is the only fingerprint difference on meetings',
  JSON.stringify(before.tables.meetings.policies.map((p) => p.replace(/ \| (PERMISSIVE|RESTRICTIVE)$/, ''))) ===
    JSON.stringify(after.tables.meetings.policies.map((p) => p.replace(/ \| (PERMISSIVE|RESTRICTIVE)$/, ''))),
  'predicate text identical; only mode differs');

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
