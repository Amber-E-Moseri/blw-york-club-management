// Produce the read-only schema fingerprint from a fresh isolated PGlite replay.
// Usage: node generate_pglite_fingerprint.mjs <output.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReplay } from './pglite_replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) {
  console.error('usage: node generate_pglite_fingerprint.mjs <output.json>');
  process.exit(2);
}

const { db, applied } = await openReplay(path.join(here, '..', 'migrations'));
const sql = fs.readFileSync(path.join(here, 'schema_fingerprint.sql'), 'utf8');
const result = await db.query(sql);
const rawFingerprint = result.rows[0]?.schema_fingerprint;
if (!rawFingerprint) throw new Error('schema_fingerprint.sql returned no fingerprint');
const fingerprint = typeof rawFingerprint === 'string' ? JSON.parse(rawFingerprint) : rawFingerprint;
if (fingerprint.default_privileges == null) fingerprint.default_privileges = [];
fs.writeFileSync(output, `${JSON.stringify(fingerprint, null, 2)}\n`);
console.log(`wrote ${output} after ${applied.length} migrations (${applied.at(-1)})`);
