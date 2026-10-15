// Unit tests (pure functions) for recipient identity; the end-to-end behaviour is proven by
// supabase/verification/p0_boundary_certification.mjs against the real Edge Function and database.
import { normalizeRecipientEmail, recipientMatchesIdentity } from '../lib/email/emailPreferenceGuard';

describe('recipientMatchesIdentity', () => {
  test('matches the same address regardless of case and surrounding whitespace', () => {
    expect(recipientMatchesIdentity('Ada@Example.test', 'ada@example.test')).toBe(true);
    expect(recipientMatchesIdentity('  ada@example.test ', 'ADA@EXAMPLE.TEST')).toBe(true);
  });

  test('rejects a different address even when the member id would be valid', () => {
    expect(recipientMatchesIdentity('stranger@example.test', 'ada@example.test')).toBe(false);
    expect(recipientMatchesIdentity('ada@example.test.evil.test', 'ada@example.test')).toBe(false);
    expect(recipientMatchesIdentity('xada@example.test', 'ada@example.test')).toBe(false);
  });

  test('wildcard characters are literal, never patterns', () => {
    expect(recipientMatchesIdentity('a_a@example.test', 'aba@example.test')).toBe(false);
    expect(recipientMatchesIdentity('%@example.test', 'ada@example.test')).toBe(false);
    expect(recipientMatchesIdentity('*@example.test', 'ada@example.test')).toBe(false);
  });

  test('empty, null or undefined never match, including empty against empty', () => {
    expect(recipientMatchesIdentity('', '')).toBe(false);
    expect(recipientMatchesIdentity(null, null)).toBe(false);
    expect(recipientMatchesIdentity('ada@example.test', null)).toBe(false);
    expect(recipientMatchesIdentity(undefined, 'ada@example.test')).toBe(false);
  });

  test('normalisation mirrors the database rule lower(trim(email))', () => {
    expect(normalizeRecipientEmail('  MiXeD@Example.TEST ')).toBe('mixed@example.test');
    expect(normalizeRecipientEmail(null)).toBe('');
  });

  test('the Deno copy and the Jest copy of the guard stay byte-identical', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const path = require('path');
    const root = path.resolve(__dirname, '..', '..');
    const a = fs.readFileSync(path.join(root, 'supabase/functions/_shared/email-preference-guard.ts'), 'utf8').replace(/\r\n/g, '\n');
    const b = fs.readFileSync(path.join(root, 'src/lib/email/emailPreferenceGuard.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(a).toBe(b);
  });
});
