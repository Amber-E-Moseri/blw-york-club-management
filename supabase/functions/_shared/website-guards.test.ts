// Unit tests for the website Edge Function helpers. Run from supabase/functions:
//   deno test -A _shared/website-guards.test.ts
import { assertEquals, assertMatch } from 'jsr:@std/assert@1';
import {
  buildStorageUrl,
  cleanLabel,
  clientAddress,
  isUuid,
  keyedHash,
  missingSecrets,
  uploadObjectPath,
  validateInquiry,
  validateUploadRequest,
  corsHeaders,
  turnstilePassed,
} from './website-guards.ts';

const VALID_INQUIRY = {
  kind: 'contact',
  name: 'Ada',
  email: 'ada@example.com',
  phone: '',
  message: 'Hello',
  topic: '',
  consentVersion: '1',
  consentTextHash: 'a'.repeat(64),
  honeypot: '',
  turnstileToken: 'token-123',
};

Deno.test('clientAddress prefers the Cloudflare header and rejects malformed values', () => {
  assertEquals(clientAddress(new Headers({ 'cf-connecting-ip': '203.0.113.7' })), '203.0.113.7');
  assertEquals(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' })), '198.51.100.2');
  assertEquals(clientAddress(new Headers({ 'cf-connecting-ip': '2001:db8::1' })), '2001:db8::1');
  assertEquals(clientAddress(new Headers({ 'cf-connecting-ip': 'not-an-ip' })), null);
  assertEquals(clientAddress(new Headers({ 'cf-connecting-ip': '999.1.1.1' })), null);
  assertEquals(clientAddress(new Headers({})), null);
});

Deno.test('keyedHash is deterministic, keyed and not the raw value', async () => {
  const a = await keyedHash('secret-one-secret-one-secret-one-32', '203.0.113.7');
  const b = await keyedHash('secret-one-secret-one-secret-one-32', '203.0.113.7');
  const c = await keyedHash('secret-two-secret-two-secret-two-32', '203.0.113.7');
  assertEquals(a, b);
  assertMatch(a, /^[0-9a-f]{64}$/);
  assertEquals(a === c, false);
  assertEquals(a.includes('203.0.113.7'), false);
});

Deno.test('turnstilePassed trusts only an explicit success flag', () => {
  assertEquals(turnstilePassed({ success: true }), true);
  assertEquals(turnstilePassed({ success: 'true' }), false);
  assertEquals(turnstilePassed({}), false);
  assertEquals(turnstilePassed(null), false);
});

Deno.test('cleanLabel drops anything outside the safe alphabet instead of truncating', () => {
  assertEquals(cleanLabel('newsletter_2026-11'), 'newsletter_2026-11');
  assertEquals(cleanLabel('<script>'), '');
  assertEquals(cleanLabel('a'.repeat(41)), '');
  assertEquals(cleanLabel(null), '');
});

Deno.test('buildStorageUrl accepts only signed paths on a trusted base', () => {
  const ok = '/object/sign/rhapsody-pdfs/2026/11/x.pdf?token=abc.def-ghi';
  assertEquals(buildStorageUrl('https://proj.supabase.co', ok), `https://proj.supabase.co/storage/v1${ok}`);
  assertEquals(buildStorageUrl('http://127.0.0.1:54321', ok), `http://127.0.0.1:54321/storage/v1${ok}`);
  // Untrusted bases: plain http on a public host, or userinfo smuggling.
  assertEquals(buildStorageUrl('http://evil.example', ok), null);
  assertEquals(buildStorageUrl('https://user@evil.example', ok), null);
  // Parent-directory segments and off-pattern paths are refused.
  assertEquals(buildStorageUrl('https://proj.supabase.co', '/object/sign/site-media/../x.jpg?token=t'), null);
  assertEquals(buildStorageUrl('https://proj.supabase.co', '/object/public/site-media/x.jpg'), null);
  assertEquals(buildStorageUrl('https://proj.supabase.co', '/object/sign/x?token=a&evil=1'), null);
});

Deno.test('corsHeaders echoes only configured origins', () => {
  const allowed = ['https://www.example.org'];
  assertEquals(corsHeaders('https://www.example.org', allowed)['Access-Control-Allow-Origin'], 'https://www.example.org');
  assertEquals(corsHeaders('https://evil.example', allowed)['Access-Control-Allow-Origin'], undefined);
  assertEquals(corsHeaders(null, allowed)['Access-Control-Allow-Origin'], undefined);
});

Deno.test('missingSecrets names absent and too-short secrets', () => {
  assertEquals(missingSecrets({ A: 'x', B: '', C: undefined }), ['B', 'C']);
  assertEquals(missingSecrets({ S: 'short' }, { S: 32 }), ['S']);
  assertEquals(missingSecrets({ S: 'x'.repeat(32) }, { S: 32 }), []);
});

Deno.test('validateUploadRequest enforces bucket, MIME and size rules', () => {
  assertEquals(validateUploadRequest({ bucket: 'site-media', mime: 'image/png', bytes: 1024 }).ok, true);
  assertEquals(validateUploadRequest({ bucket: 'rhapsody-pdfs', mime: 'application/pdf', bytes: 1024 }).ok, true);
  assertEquals(validateUploadRequest({ bucket: 'site-media', mime: 'application/pdf', bytes: 1 }).ok, false);
  assertEquals(validateUploadRequest({ bucket: 'site-media', mime: 'image/png', bytes: 5 * 1024 * 1024 + 1 }).ok, false);
  assertEquals(validateUploadRequest({ bucket: 'rhapsody-pdfs', mime: 'application/pdf', bytes: 25 * 1024 * 1024 + 1 }).ok, false);
  assertEquals(validateUploadRequest({ bucket: 'public', mime: 'image/png', bytes: 1 }).ok, false);
  assertEquals(validateUploadRequest({ bucket: 'site-media', mime: 'image/png', bytes: 0 }).ok, false);
  assertEquals(validateUploadRequest({ bucket: 'site-media', mime: 'image/png', bytes: 1, name: 'x' }).ok, false);
});

Deno.test('uploadObjectPath never uses the original name and requires a UUID', () => {
  const id = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';
  assertEquals(
    uploadObjectPath('site-media', 'image/jpeg', id, new Date('2026-11-05T12:00:00Z')),
    '2026/11/3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg',
  );
  let threw = false;
  try {
    uploadObjectPath('site-media', 'image/jpeg', '../../etc', new Date());
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('validateInquiry accepts the exact shape and refuses extra or malformed fields', () => {
  assertEquals(validateInquiry(VALID_INQUIRY).ok, true);
  assertEquals(validateInquiry({ ...VALID_INQUIRY, email: 'nope' }).ok, false);
  assertEquals(validateInquiry({ ...VALID_INQUIRY, kind: 'admin' }).ok, false);
  assertEquals(validateInquiry({ ...VALID_INQUIRY, role: 'admin' }).ok, false);
  assertEquals(validateInquiry({ ...VALID_INQUIRY, consentTextHash: 'XYZ' }).ok, false);
  assertEquals(validateInquiry({ ...VALID_INQUIRY, message: 'x'.repeat(4001) }).ok, false);
  assertEquals(validateInquiry({ ...VALID_INQUIRY, turnstileToken: '' }).ok, false);
  assertEquals(validateInquiry(null).ok, false);
});

Deno.test('isUuid rejects non-UUID strings', () => {
  assertEquals(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301'), true);
  assertEquals(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c330'), false);
  assertEquals(isUuid(null), false);
});
