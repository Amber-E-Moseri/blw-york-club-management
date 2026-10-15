// Offline unit checks for the certification target guard in lib.mjs. No network and no Supabase project is contacted.
// Every hosted case must be refused unless the URL names exactly CERT_EXPECTED_PROJECT_REF and that reference is not
// on the deny list. Exit 0 = all pass, 1 = any failure.

const lib = await import(new URL('./lib.mjs', import.meta.url).href);

const cases = [
  ['local URL, no hosted flag', 'http://127.0.0.1:54321', {}, true],
  ['hosted URL without CERT_HOSTED', 'https://abcdefghijklmnopqrst.supabase.co', {}, false],
  ['hosted, reference matches expected', 'https://abcdefghijklmnopqrst.supabase.co', { CERT_HOSTED: '1', CERT_EXPECTED_PROJECT_REF: 'abcdefghijklmnopqrst' }, true],
  ['hosted, reference mismatch', 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co', { CERT_HOSTED: '1', CERT_EXPECTED_PROJECT_REF: 'abcdefghijklmnopqrst' }, false],
  ['hosted, expected reference missing', 'https://abcdefghijklmnopqrst.supabase.co', { CERT_HOSTED: '1' }, false],
  ['hosted, production reference denied', 'https://rjtstjmtddqhesexltbj.supabase.co', { CERT_HOSTED: '1', CERT_EXPECTED_PROJECT_REF: 'rjtstjmtddqhesexltbj' }, false],
  ['hosted, Preview reference denied', 'https://yziuhtxtznginhdpqurb.supabase.co', { CERT_HOSTED: '1', CERT_EXPECTED_PROJECT_REF: 'yziuhtxtznginhdpqurb' }, false],
  ['hosted, http scheme refused', 'http://abcdefghijklmnopqrst.supabase.co', { CERT_HOSTED: '1', CERT_EXPECTED_PROJECT_REF: 'abcdefghijklmnopqrst' }, false],
  ['hosted flag with a local URL', 'http://127.0.0.1:54321', { CERT_HOSTED: '1' }, false],
];

let failures = 0;
for (const [name, url, env, wantAccepted] of cases) {
  delete process.env.CERT_HOSTED;
  delete process.env.CERT_EXPECTED_PROJECT_REF;
  Object.assign(process.env, env);
  let accepted = true;
  try { lib.assertCertificationTarget(url); } catch { accepted = false; }
  const ok = accepted === wantAccepted;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`SUMMARY ${cases.length - failures} PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
