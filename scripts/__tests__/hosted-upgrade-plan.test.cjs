// Read-only comparison used for the hosted Preview and Production upgrade plan. Synthetic inputs only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mod = import(path.join(__dirname, '..', 'hosted-upgrade-plan.mjs'));

test('ledger parsing reads version and name, and rejects a file without a header', async () => {
  const { parseLedger } = await mod;
  assert.deepEqual(parseLedger('version,name\n038,attendance\n060,bsc_scoped_policies\n'), [
    { version: '038', name: 'attendance' },
    { version: '060', name: 'bsc_scoped_policies' },
  ]);
  assert.throws(() => parseLedger('038,attendance\n'), /header/);
});

test('a candidate whose version is recorded under the same name is recorded, not re-applied', async () => {
  const { plan } = await mod;
  const chain = [{ file: '060_bsc_scoped_policies.sql', version: '060', stem: 'bsc_scoped_policies' }];
  const p = plan({ chain, ledger: [{ version: '060', name: 'bsc_scoped_policies' }] });
  assert.equal(p.rows[0].status, 'recorded');
});

test('a version recorded under a different name is a collision for owner review, not an automatic match', async () => {
  const { plan } = await mod;
  const chain = [{ file: '061_shared_audience_infrastructure.sql', version: '061', stem: 'shared_audience_infrastructure' }];
  const p = plan({ chain, ledger: [{ version: '061', name: 'something_else' }] });
  assert.equal(p.rows[0].status, 'collision');
  assert.equal(p.rows[0].ledgerName, 'something_else');
});

test('candidates missing from the ledger are absent, and ledger versions outside the chain are reported', async () => {
  const { plan } = await mod;
  const chain = [
    { file: '060_a.sql', version: '060', stem: 'a' },
    { file: '061_b.sql', version: '061', stem: 'b' },
  ];
  const p = plan({ chain, ledger: [{ version: '060', name: 'a' }, { version: '099', name: 'hosted_only' }] });
  assert.deepEqual(p.rows.map((r) => r.status), ['recorded', 'absent']);
  assert.deepEqual(p.extraInLedger.map((r) => r.version), ['099']);
});

test('fingerprint diff lists objects present on one side only, per kind', async () => {
  const { fingerprintDiff } = await mod;
  const golden = { tables: { a: {}, b: {} }, views: {}, functions: { f: {} } };
  const hosted = { tables: { a: {}, c: {} }, views: {}, functions: { f: {}, g: {} } };
  const d = fingerprintDiff(golden, hosted);
  assert.deepEqual(d.tables, { onlyInGolden: ['b'], onlyInHosted: ['c'] });
  assert.deepEqual(d.functions, { onlyInGolden: [], onlyInHosted: ['g'] });
});

test('a hosted catalog gap lists missing and extra objects by name, and maps a missing object to its candidate migration', async () => {
  const { catalogGap, creatingMigration } = await mod;
  const golden = { tables: { a: {}, b: {} }, views: { v1: {} }, functions: { 'f(uuid)': {} } };
  const catalog = {
    server_version: '17.11',
    relations: [
      { kind: 'r', schema: 'public', name: 'a' },
      { kind: 'r', schema: 'public', name: 'extra_t' },
      { kind: 'v', schema: 'public', name: 'v1' },
    ],
    functions_summary: [],
  };
  const gap = catalogGap(golden, catalog);
  assert.deepEqual(gap.tables, { missingInHosted: ['b'], extraInHosted: ['extra_t'] });
  assert.deepEqual(gap.functions, { missingInHosted: ['f'], extraInHosted: [] });
  assert.equal(gap.serverVersion, '17.11');
  const files = { '/m/060_x.sql': 'create table if not exists public.b (id int);' };
  const chain = [{ file: '060_x.sql', version: '060', stem: 'x' }];
  assert.equal(creatingMigration('b', chain, '/m', (f) => files[f]), '060_x.sql');
  assert.equal(creatingMigration('zzz', chain, '/m', (f) => files[f]), null);
});
