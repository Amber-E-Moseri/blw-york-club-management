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
