import { describe, expect, it, vi } from 'vitest';
// The shared Edge Function helpers import Zod from the pinned esm.sh URL. Tests use the installed package.
vi.mock('https://esm.sh/zod@3.23.8', async () => await import('zod'));

import { applyBrandVariables, brandPalette, contrastRatio, DEFAULT_BRAND, isHexColour, resolveBrand } from '../lib/brand';
import { applyPublishedContent, editionsToSiteContent, unpublishedBase } from '../content/published';
import { sampleContent } from '../content/sample-data';
import { postProtectedInquiry, type ProtectedInquiry } from '../api/inquiryFunction';
import {
  buildStorageUrl, cleanLabel, clientAddress, corsHeaders, isUuid, keyedHash, turnstilePassed,
  uploadObjectPath, validateInquiry, validateUploadRequest,
} from '../../../supabase/functions/_shared/website-guards';

const HASH64 = 'a'.repeat(64);
const GOOD_INQUIRY = {
  kind: 'contact', name: 'Ada', email: 'ada@example.org', phone: '', message: 'Hello', topic: 'General inquiry',
  consentVersion: 'v1', consentTextHash: HASH64, honeypot: '', turnstileToken: 'token-value',
} as const;
const EDITION_ID = '0f9c1d2e-3a4b-4c5d-8e9f-001122334455';

describe('brand colour', () => {
  it('accepts a safe six-digit colour and normalises its case', () => {
    expect(resolveBrand('#1d4ed8')).toBe('#1D4ED8');
  });

  it('falls back to the approved default for anything that is not a six-digit hex colour', () => {
    for (const bad of ['red', '#fff', '#GGGGGG', 12, null, undefined, 'javascript:alert(1)', '#C8102E;background:url(x)']) {
      expect(resolveBrand(bad)).toBe(DEFAULT_BRAND);
    }
  });

  it('falls back when white text on the colour would fail WCAG AA contrast', () => {
    expect(resolveBrand('#FFFF00')).toBe(DEFAULT_BRAND);
  });

  it('the approved default passes WCAG AA with white text', () => {
    expect(contrastRatio(DEFAULT_BRAND, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('derives hover, deep and soft shades that are valid colours', () => {
    const p = brandPalette('#1D4ED8');
    expect(p.hover).not.toBe(p.brand);
    expect([p.brand, p.hover, p.deep, p.soft].every(isHexColour)).toBe(true);
  });

  it('writes the palette into CSS custom properties', () => {
    const el = document.createElement('div');
    applyBrandVariables(el, '#1D4ED8');
    expect(el.style.getPropertyValue('--color-brand')).toBe('#1D4ED8');
    expect(el.style.getPropertyValue('--color-brand-soft')).toMatch(/^#/);
  });
});

describe('published branding and Rhapsody links', () => {
  const settingsRow = (body: Record<string, unknown>) => ({ kind: 'settings' as const, key: 'site', body, versionNo: 1, publishedAt: '2026-10-01T00:00:00Z' });

  it('applies a safe published colour', () => {
    const out = applyPublishedContent(unpublishedBase(sampleContent), [settingsRow({ site_name: 'X', primary_color: '#1d4ed8' })]);
    expect(out.settings.primaryColor).toBe('#1D4ED8');
  });

  it('uses the default when the published colour is unsafe', () => {
    const out = applyPublishedContent(unpublishedBase(sampleContent), [settingsRow({ site_name: 'X', primary_color: '#FFFF00' })]);
    expect(out.settings.primaryColor).toBe(DEFAULT_BRAND);
  });

  it('builds a Rhapsody link through the delivery function only for a valid edition id', () => {
    const [ok, bad] = editionsToSiteContent([
      { editionId: EDITION_ID, kind: 'monthly', periodStart: '2026-11-01', title: 'Nov', description: '', authorizedBy: 'Pastor' },
      { editionId: 'not-an-id', kind: 'daily', periodStart: '2026-11-01', title: 'Bad', description: '', authorizedBy: 'Pastor' },
    ], 'https://p.example.co/functions/v1/website-rhapsody-pdf');
    expect(ok.pdfPath).toBe(`https://p.example.co/functions/v1/website-rhapsody-pdf?edition=${EDITION_ID}`);
    expect(bad.pdfPath).toBe('');
  });

  it('gives no PDF link when no delivery address is configured', () => {
    const [e] = editionsToSiteContent([{ editionId: EDITION_ID, kind: 'monthly', periodStart: '2026-11-01', title: 'Nov', description: '', authorizedBy: 'Pastor' }]);
    expect(e.pdfPath).toBe('');
  });

  it('the production base removes fictional people, records and contact details', () => {
    const base = unpublishedBase(sampleContent);
    expect(base.about.leaders).toEqual([]);
    expect(base.events).toEqual([]);
    expect(base.posts).toEqual([]);
    expect(base.rhapsody).toEqual([]);
    expect(base.settings).toMatchObject({ email: '', socials: [], foundationEnrollUrl: '', isSample: false });
  });
});

describe('protected inquiry client', () => {
  const url = 'https://p.example.co';
  const body: ProtectedInquiry = { ...GOOD_INQUIRY };

  it('resolves on 202 and posts to the inquiry function with the anon key only', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const fetchImpl = (async (u: string, init: RequestInit) => {
      seen = { url: u, headers: init.headers as Record<string, string> };
      return new Response('{"received":true}', { status: 202 });
    }) as unknown as typeof fetch;
    await postProtectedInquiry(url, 'anon-key', body, fetchImpl);
    expect(seen?.url).toBe('https://p.example.co/functions/v1/website-inquiry');
    expect(seen?.headers.apikey).toBe('anon-key');
  });

  it('shows the server message on a refusal', async () => {
    const fetchImpl = (async () => new Response('{"error":"Too many messages were sent from this connection."}', { status: 429 })) as unknown as typeof fetch;
    await expect(postProtectedInquiry(url, 'anon-key', body, fetchImpl)).rejects.toThrow('Too many messages were sent from this connection.');
  });

  it('uses generic wording when the server reply is not understood', async () => {
    const fetchImpl = (async () => new Response('<html>oops</html>', { status: 500 })) as unknown as typeof fetch;
    await expect(postProtectedInquiry(url, 'anon-key', body, fetchImpl)).rejects.toThrow('Your message could not be sent');
  });

  it('reports a network failure without claiming success', async () => {
    const fetchImpl = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    await expect(postProtectedInquiry(url, 'anon-key', body, fetchImpl)).rejects.toThrow('We could not reach the server');
  });
});

describe('edge guards (shared with the Edge Functions)', () => {
  it('reads the client address from the edge header first and rejects malformed values', () => {
    expect(clientAddress(new Headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.2' }))).toBe('203.0.113.7');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2');
    expect(clientAddress(new Headers({ 'cf-connecting-ip': 'not-an-ip; drop table' }))).toBeNull();
    expect(clientAddress(new Headers())).toBeNull();
  });

  it('keys client identifiers with HMAC-SHA256 (RFC 4231 vector) and never returns the raw value', async () => {
    expect(await keyedHash('key', 'The quick brown fox jumps over the lazy dog')).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    const a = await keyedHash('secret-one-that-is-long-enough-1234', '203.0.113.7');
    const b = await keyedHash('secret-two-that-is-long-enough-1234', '203.0.113.7');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('203.0.113.7');
  });

  it('trusts only an explicit success from Turnstile', () => {
    expect(turnstilePassed({ success: true })).toBe(true);
    expect(turnstilePassed({ success: 'true' })).toBe(false);
    expect(turnstilePassed({})).toBe(false);
    expect(turnstilePassed(null)).toBe(false);
  });

  it('drops campaign labels that are outside the safe alphabet', () => {
    expect(cleanLabel('spring_2026-x')).toBe('spring_2026-x');
    expect(cleanLabel('<script>')).toBe('');
    expect(cleanLabel('a'.repeat(41))).toBe('');
  });

  it('issues storage URLs only for signed object paths on a trusted base', () => {
    expect(buildStorageUrl('https://p.example.co', '/object/sign/rhapsody-pdfs/2026/10/x.pdf?token=abc.def')).toBe(
      'https://p.example.co/storage/v1/object/sign/rhapsody-pdfs/2026/10/x.pdf?token=abc.def');
    expect(buildStorageUrl('https://p.example.co', '/object/sign/../../admin?token=a')).toBeNull();
    expect(buildStorageUrl('http://evil.example', '/object/sign/rhapsody-pdfs/x.pdf?token=a')).toBeNull();
  });

  it('checks the shape of each upload request', () => {
    expect(validateUploadRequest({ bucket: 'site-media', mime: 'image/png', bytes: 1000 }).ok).toBe(true);
    expect(validateUploadRequest({ bucket: 'site-media', mime: 'application/pdf', bytes: 1000 }).ok).toBe(false);
    expect(validateUploadRequest({ bucket: 'rhapsody-pdfs', mime: 'application/pdf', bytes: 26214401 }).ok).toBe(false);
    expect(validateUploadRequest({ bucket: 'site-media', mime: 'image/png', bytes: 5242881 }).ok).toBe(false);
    expect(validateUploadRequest({ bucket: '../secret', mime: 'image/png', bytes: 10 }).ok).toBe(false);
  });

  it('names uploads by generated id, never by the original file name', () => {
    expect(uploadObjectPath('site-media', 'image/webp', EDITION_ID.toUpperCase(), new Date('2026-10-15T12:00:00Z')))
      .toBe(`2026/10/${EDITION_ID}.webp`);
    expect(() => uploadObjectPath('site-media', 'image/webp', '../../etc', new Date())).toThrow();
    expect(isUuid(EDITION_ID)).toBe(true);
  });

  it('validates an inquiry before it reaches the database', () => {
    expect(validateInquiry(GOOD_INQUIRY).ok).toBe(true);
    expect(validateInquiry({ ...GOOD_INQUIRY, kind: 'admin' }).ok).toBe(false);
    expect(validateInquiry({ ...GOOD_INQUIRY, email: 'nope' }).ok).toBe(false);
    expect(validateInquiry({ ...GOOD_INQUIRY, consentTextHash: 'short' }).ok).toBe(false);
    expect(validateInquiry({ ...GOOD_INQUIRY, turnstileToken: '' }).ok).toBe(false);
    expect(validateInquiry({ ...GOOD_INQUIRY, message: 'x'.repeat(4001) }).ok).toBe(false);
    expect(validateInquiry(null).ok).toBe(false);
  });

  it('echoes CORS only for configured origins', () => {
    const allowed = ['https://blwyork.example'];
    expect(corsHeaders('https://blwyork.example', allowed)['Access-Control-Allow-Origin']).toBe('https://blwyork.example');
    expect(corsHeaders('https://evil.example', allowed)['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
