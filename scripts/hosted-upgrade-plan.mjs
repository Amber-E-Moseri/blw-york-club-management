// Read-only upgrade plan for one hosted project. Compares a migration-ledger export and a catalog fingerprint with the
// candidate chain in supabase/migrations and the golden fingerprint. Writes nothing and contacts no service.
//
// Usage:
//   node scripts/hosted-upgrade-plan.mjs --label preview --ledger hosted-preview-ledger.csv \
//     --fingerprint hosted-preview-fingerprint.json [--golden supabase/verification/schema_fingerprint.golden.json]
//
// Ledger CSV: header "version,name" (version as stored in supabase_migrations.schema_migrations, name may be empty).
// Fingerprint JSON: the output of supabase/verification/schema_fingerprint.sql (same shape as the golden file).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export function parseLedger(csv) {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || !/^version,/i.test(lines[0])) throw new Error('ledger CSV must start with a "version,name" header');
  return lines.slice(1).map((line) => {
    const [version, ...rest] = line.split(',');
    return { version: version.trim(), name: rest.join(',').trim() };
  });
}

export function candidateChain(migrationsDir) {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ file: f, version: f.slice(0, 3), stem: basename(f, '.sql').slice(4) }));
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\.sql$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function plan({ chain, ledger }) {
  const byVersion = new Map();
  for (const row of ledger) byVersion.set(String(row.version).padStart(3, '0'), row);
  const rows = chain.map((m) => {
    const hit = byVersion.get(m.version);
    if (!hit) return { ...m, status: 'absent' };
    if (hit.name && norm(hit.name) !== norm(m.stem)) return { ...m, status: 'collision', ledgerName: hit.name };
    return { ...m, status: 'recorded' };
  });
  const chainVersions = new Set(chain.map((m) => m.version));
  const extra = ledger.filter((r) => !chainVersions.has(String(r.version).padStart(3, '0')));
  return { rows, extraInLedger: extra };
}

function objectSets(fp) {
  const out = {};
  for (const kind of ['tables', 'views', 'functions']) {
    out[kind] = new Set(Object.keys(fp?.[kind] ?? {}));
  }
  return out;
}

export function fingerprintDiff(golden, hosted) {
  const g = objectSets(golden);
  const h = objectSets(hosted);
  const result = {};
  for (const kind of Object.keys(g)) {
    result[kind] = {
      onlyInGolden: [...g[kind]].filter((x) => !h[kind].has(x)).sort(),
      onlyInHosted: [...h[kind]].filter((x) => !g[kind].has(x)).sort(),
    };
  }
  return result;
}

function main(argv) {
  const args = Object.fromEntries(argv.reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []));
  const label = args.label ?? 'project';
  const root = process.cwd();
  if (!args.ledger) throw new Error('--ledger is required');
  const ledger = parseLedger(readFileSync(resolve(args.ledger), 'utf8'));
  const chain = candidateChain(join(root, 'supabase', 'migrations'));
  const p = plan({ chain, ledger });
  const counts = p.rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  console.log(`[${label}] ledger rows: ${ledger.length}; candidate files: ${chain.length}`);
  console.log(`[${label}] candidate status: ${JSON.stringify(counts)}`);
  for (const r of p.rows.filter((x) => x.status !== 'recorded')) {
    console.log(`[${label}] ${r.version} ${r.stem}: ${r.status}${r.ledgerName ? ` (ledger name: ${r.ledgerName})` : ''}`);
  }
  console.log(`[${label}] ledger versions outside the candidate chain: ${p.extraInLedger.map((r) => r.version).join(' ') || 'none'}`);
  if (args.fingerprint) {
    const hosted = JSON.parse(readFileSync(resolve(args.fingerprint), 'utf8'));
    const golden = existsSync(args.golden ?? '') ? JSON.parse(readFileSync(resolve(args.golden), 'utf8')) : JSON.parse(readFileSync(join(root, 'supabase/verification/schema_fingerprint.golden.json'), 'utf8'));
    const diff = fingerprintDiff(golden, hosted);
    for (const [kind, d] of Object.entries(diff)) {
      console.log(`[${label}] ${kind}: only in golden ${d.onlyInGolden.length}, only in hosted ${d.onlyInHosted.length}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
