#!/usr/bin/env node
// Compares a HOSTED migration history with the canonical migration set. READ-ONLY: it reads a file you saved from
// a SELECT and reports; it never connects to a database and never changes anything.
//
// Input: JSON array of {"version": "038", "name": "..."} rows, produced by:
//   select version, name from supabase_migrations.schema_migrations order by version;
// (save the SQL editor result as JSON, or as CSV with a header line "version,name").
//
// Usage:
//   node supabase/verification/check_migration_history.mjs hosted-history.json [--canonical supabase/migrations]
//
// Exit 0 when the hosted history is a prefix-compatible subset of the canonical set with no unknown or renamed
// entries. Exit 1 otherwise. The report says what to do next; it does not decide anything.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const canonicalDir = args.includes('--canonical') ? args[args.indexOf('--canonical') + 1] : 'supabase/migrations';
if (!input) {
  console.error('usage: check_migration_history.mjs <hosted-history.json|.csv> [--canonical dir]');
  process.exit(2);
}

// Canonical set: "NNN_name.sql" files, keyed by the 3-digit version.
const canonical = new Map();
for (const f of fs.readdirSync(canonicalDir).filter((n) => /^\d{3}_.+\.sql$/.test(n)).sort()) {
  const version = f.slice(0, 3);
  canonical.set(version, f.replace(/\.sql$/, '').slice(4));
}

// Hosted rows.
const raw = fs.readFileSync(input, 'utf8').trim();
let rows;
if (raw.startsWith('[')) {
  rows = JSON.parse(raw);
} else {
  const [header, ...lines] = raw.split(/\r?\n/);
  const cols = header.split(',').map((c) => c.trim());
  rows = lines.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
}
const hosted = new Map();
for (const r of rows) {
  const version = String(r.version).padStart(3, '0');
  hosted.set(version, String(r.name ?? '').replace(/\.sql$/, ''));
}

const problems = [];
const notes = [];

for (const [version, name] of hosted) {
  if (!canonical.has(version)) {
    problems.push(`UNKNOWN  hosted version ${version} (${name}) is not in the canonical set. Investigate before anything else.`);
    continue;
  }
  const canonName = canonical.get(version);
  if (name !== canonName) {
    problems.push(`RENAMED  version ${version}: hosted name "${name}", canonical "${canonName}". This is the BSC/notification collision if the names differ by topic. Do not renumber; reconcile the history with a person.`);
  }
}

for (const [version, name] of canonical) {
  if (!hosted.has(version)) {
    notes.push(`PENDING  ${version}_${name} is not recorded on hosted. Apply in order only after approval.`);
  }
}

// Ordering sanity: once a version is pending, a later one recorded on hosted is a gap that must be explained.
const pendingVersions = [...canonical.keys()].filter((v) => !hosted.has(v));
const firstPending = pendingVersions[0];
if (firstPending) {
  for (const v of hosted.keys()) {
    if (v > firstPending) problems.push(`GAP      version ${v} is recorded but ${firstPending} is not. Explain the gap before applying anything.`);
  }
}

const bscOldNumbers = ['038_bsc_hierarchy_access', '039_bsc_member_views', '040_bsc_grants', '041_bsc_function_grants', '042_bsc_policy_and_search_path'];
for (const old of bscOldNumbers) {
  const [v, ...rest] = old.split('_');
  const name = rest.join('_');
  if (hosted.get(v) === name) problems.push(`BSC-OLD  hosted records ${old}. The BSC set was applied under its old number. Renumbering now would rewrite applied history: stop and reconcile.`);
}

console.log(`hosted rows: ${hosted.size}   canonical files: ${canonical.size}`);
for (const n of notes) console.log(n);
for (const p of problems) console.log(p);
if (problems.length === 0) console.log('RESULT: consistent with the canonical set. Pending entries are still to be applied, after approval.');
else console.log(`RESULT: ${problems.length} problem(s). Do not apply migrations until each is explained.`);
process.exit(problems.length ? 1 : 0);
