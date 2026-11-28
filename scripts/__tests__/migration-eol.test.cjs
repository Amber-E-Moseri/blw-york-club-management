// Migration text is hashed into the schema fingerprint (function bodies), so a CR byte in any migration changes the
// fingerprint. This fails on a working copy that has CRLF line endings. Enforced by .gitattributes (eol=lf).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('every migration on disk uses LF line endings', () => {
  const dir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .filter((f) => fs.readFileSync(path.join(dir, f)).includes(0x0d));
  assert.deepEqual(offenders, [], 'CRLF in migrations changes function definition hashes');
});
