import { describe, expect, it } from 'vitest';
import { createWebsiteApi } from '../api/websiteApi';
import { editionsToSiteContent, mergePublished } from '../content/published';
import { sampleContent } from '../content/sample-data';

interface Call { url: string; init: RequestInit }
function fakeFetch(bodies: unknown[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = bodies.shift() ?? null;
    return new Response(body === null ? '' : JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}
const api = (token: string | null, impl: typeof fetch) => createWebsiteApi({ url: 'https://p.example.co', anonKey: 'anon', getAccessToken: () => token, fetchImpl: impl });

describe('Rhapsody and analytics calls', () => {
  it('saves an edition through the RPC with the expected version', async () => {
    const { calls, impl } = fakeFetch([null]);
    await api('user', impl).saveEdition({ id: null, kind: 'monthly', periodStart: '2026-10-01', title: 'October 2026', description: '', pdfMediaId: 'm1', expectedVersion: 0 });
    expect(calls[0].url).toBe('https://p.example.co/rest/v1/rpc/web_save_edition');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ p_kind: 'monthly', p_pdf_media_id: 'm1', p_expected_version: 0 });
  });

  it('authorizes and publishes with explicit RPCs, never by a direct table write', async () => {
    const { calls, impl } = fakeFetch([null, null]);
    const a = api('user', impl);
    await a.authorizeEdition('e1', 'Pastor Test', 1);
    await a.setEditionStatus('e1', 'published', 2);
    expect(calls.map((c) => c.url)).toEqual(['https://p.example.co/rest/v1/rpc/web_authorize_edition', 'https://p.example.co/rest/v1/rpc/web_set_edition_status']);
  });

  it('maps analytics rows and keeps the withheld-visitor text as text', async () => {
    const { impl } = fakeFetch([[{ edition_id: 'e1', title: 'Oct', clicks: '7', approx_visitors: 'fewer than 5', first_day: '2026-10-01', last_day: '2026-10-10' }]]);
    const rows = await api('user', impl).downloadStats(30);
    expect(rows[0]).toEqual({ editionId: 'e1', title: 'Oct', clicks: 7, approxVisitors: 'fewer than 5', firstDay: '2026-10-01', lastDay: '2026-10-10' });
  });

  it('sends public inquiries and download clicks with the anon key only', async () => {
    const { calls, impl } = fakeFetch([null, null]);
    const a = api('user-token-must-not-be-used', impl);
    await a.submitInquiry({ kind: 'contact', name: 'A', email: 'a@example.org', phone: '', message: 'Hi', topic: 'General inquiry', consentVersion: 'v1', consentTextHash: 'a'.repeat(64), honeypot: '' });
    await a.recordDownload('e1', 'home', '', '', 'b'.repeat(64));
    for (const c of calls) {
      expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer anon');
      expect(c.url).toContain('/rest/v1/rpc/');
    }
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ p_kind: 'contact', p_honeypot: '' });
  });

  it('reads published editions through the view with the anon key', async () => {
    const { calls, impl } = fakeFetch([[{ edition_id: 'e1', kind: 'monthly', period_start: '2026-10-01', title: 'Oct', description: 'd', authorized_by: 'Pastor' }]]);
    const rows = await api('user', impl).publicEditions();
    expect(calls[0].url).toContain('/rest/v1/v_public_editions?');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer anon');
    expect(rows[0]).toMatchObject({ editionId: 'e1', authorizedBy: 'Pastor' });
  });
});

describe('published editions on the public site', () => {
  it('maps editions with no PDF path, so the reader hides controls instead of linking to nothing', () => {
    const [e] = editionsToSiteContent([{ editionId: 'e1', kind: 'daily', periodStart: '2026-10-15', title: '15 October 2026', description: 'Reading', authorizedBy: 'Pastor' }]);
    expect(e).toEqual({ slug: 'e1', title: '15 October 2026', kind: 'Daily', period: '2026-10-15', blurb: 'Reading', pdfPath: '', authorizedBy: 'Pastor' });
  });

  it('uses published editions when present and keeps the sample library when none are published', () => {
    const withEditions = mergePublished(sampleContent, { content: [], posts: [], events: [], editions: [{ editionId: 'e9', kind: 'monthly', periodStart: '2026-11-01', title: 'November', description: '', authorizedBy: 'Pastor' }] });
    expect(withEditions.rhapsody.map((e) => e.slug)).toEqual(['e9']);
    const without = mergePublished(sampleContent, { content: [], posts: [], events: [], editions: [] });
    expect(without.rhapsody).toEqual(sampleContent.rhapsody);
  });
});
