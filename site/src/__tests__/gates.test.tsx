import { describe, expect, it, vi, afterEach } from 'vitest';
// The shared Edge Function helpers import Zod from the pinned esm.sh URL. Tests use the installed package.
vi.mock('https://esm.sh/zod@3.23.8', async () => await import('zod'));

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PublishedApp } from '../content/PublishedApp';
import { applyPublishedContent, isSafeImageAddress, unpublishedBase } from '../content/published';
import { sampleContent } from '../content/sample-data';
import { validateInquiry, validateUploadRequest } from '../../../supabase/functions/_shared/website-guards';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_NO_TURNSTILE = { url: 'https://p.example.co', anonKey: 'anon-key-value', turnstileSiteKey: null };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Content Security Policy (Vercel headers)', () => {
  const config = JSON.parse(readFileSync(path.join(here, '..', '..', 'vercel.json'), 'utf8')) as {
    headers: { headers: { key: string; value: string }[] }[];
  };
  const headers = Object.fromEntries(config.headers[0].headers.map((h) => [h.key, h.value]));
  const csp = headers['Content-Security-Policy'];
  const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) ?? '';

  it('allows Cloudflare Turnstile to load its script and frame', () => {
    expect(directive('script-src')).toContain('https://challenges.cloudflare.com');
    expect(directive('frame-src')).toContain('https://challenges.cloudflare.com');
    expect(directive('connect-src')).toContain('https://challenges.cloudflare.com');
  });

  it('allows the Supabase API and the signed PDF links', () => {
    expect(directive('connect-src')).toContain('https://*.supabase.co');
    expect(directive('object-src')).toContain('https://*.supabase.co');
  });

  it('does not allow arbitrary scripts or framing', () => {
    expect(directive('script-src')).not.toContain('unsafe-eval');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
  });
});

describe('Zod validation on the Edge Function paths', () => {
  const GOOD = {
    kind: 'contact', name: 'Ada', email: 'ada@example.org', phone: '', message: 'Hello', topic: 'General inquiry',
    consentVersion: 'v1', consentTextHash: 'a'.repeat(64), honeypot: '', turnstileToken: 'token',
  };

  it('refuses unexpected fields, so a client cannot smuggle values past the schema', () => {
    expect(validateInquiry({ ...GOOD, role: 'admin' }).ok).toBe(false);
  });

  it('refuses a consent hash that is not 64 lowercase hex characters', () => {
    expect(validateInquiry({ ...GOOD, consentTextHash: 'A'.repeat(64) }).ok).toBe(false);
  });

  it('refuses an upload with an unexpected field or a size over the limit', () => {
    expect(validateUploadRequest({ bucket: 'site-media', mime: 'image/png', bytes: 10, path: '../x' }).ok).toBe(false);
    expect(validateUploadRequest({ bucket: 'site-media', mime: 'image/png', bytes: 5 * 1024 * 1024 + 1 }).ok).toBe(false);
  });
});

describe('published image addresses', () => {
  it('accepts https addresses and site paths', () => {
    expect(isSafeImageAddress('https://cdn.example.org/logo.png')).toBe(true);
    expect(isSafeImageAddress('/media/logo.png')).toBe(true);
  });

  it('refuses credentials, plain http, traversal and script schemes', () => {
    expect(isSafeImageAddress('https://user:pw@cdn.example.org/x.png')).toBe(false);
    expect(isSafeImageAddress('http://cdn.example.org/x.png')).toBe(false);
    expect(isSafeImageAddress('/media/../secret.png')).toBe(false);
    expect(isSafeImageAddress('javascript:alert(1)')).toBe(false);
  });

  it('maps logo, favicon and hero from published settings, and drops unsafe ones', () => {
    const row = (body: Record<string, unknown>) => ({ kind: 'settings' as const, key: 'site', body, versionNo: 1, publishedAt: '2026-10-01T00:00:00Z' });
    const ok = applyPublishedContent(unpublishedBase(sampleContent), [row({ site_name: 'X', logo_url: '/media/logo.png', favicon_url: 'https://cdn.example.org/f.png', hero_image_url: 'http://evil.example/h.png' })]);
    expect(ok.settings.logoUrl).toBe('/media/logo.png');
    expect(ok.settings.faviconUrl).toBe('https://cdn.example.org/f.png');
    expect(ok.settings.heroImageUrl).toBe('');
  });

  it('defaults to no logo, favicon or hero when nothing is published', () => {
    expect(unpublishedBase(sampleContent).settings).toMatchObject({ logoUrl: '', faviconUrl: '', heroImageUrl: '' });
  });
});

describe('connected site without the protected inquiry path', () => {
  it('refuses to send a message and never reports success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/contact']}>
        <PublishedApp config={CONFIG_NO_TURNSTILE} />
      </MemoryRouter>,
    );
    await screen.findByLabelText(/Full name/);
    await user.selectOptions(screen.getByLabelText(/Topic/), 'Events');
    await user.type(screen.getByLabelText(/Full name/), 'Ada');
    await user.type(screen.getByLabelText(/Email/), 'ada@example.org');
    await user.type(screen.getByLabelText(/Message/), 'Hello');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Messages cannot be sent right now');
    expect(screen.queryByText(/Thank you/)).toBeNull();
    expect(screen.queryByText(/Demo only/)).toBeNull();
  });

  it('never shows placeholder copy for unpublished pages or home text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    render(
      <MemoryRouter initialEntries={['/']}>
        <PublishedApp config={CONFIG_NO_TURNSTILE} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('BLW York Hub'));
    expect(screen.queryByText(/FAITH · FRIENDSHIP/)).toBeNull();
    expect(screen.queryByText(/A place to grow/)).toBeNull();
    expect(screen.queryByText(/Name Surname/)).toBeNull();
  });
});

describe('About and New Here are connected to published pages', () => {
  const page = (key: string, sections: Record<string, unknown>[]) => ({ kind: 'page' as const, key, body: { title: 'T', sections }, versionNo: 1, publishedAt: '2026-10-01T00:00:00Z' });

  it('publishes About when its mission is published, and maps mission and vision', () => {
    const out = applyPublishedContent(unpublishedBase(sampleContent), [page('about', [
      { type: 'text', heading: 'Mission', body: 'Grow in God\'s Word.', visible: true },
      { type: 'text', heading: 'Vision', body: 'A generation fulfilling God\'s dream.', visible: true },
    ])]);
    expect(out.about.mission).toBe("Grow in God's Word.");
    expect(out.about.vision).toBe("A generation fulfilling God's dream.");
    expect(out.publishedPages.about).toBe(true);
  });

  it('keeps About unpublished when it has no visible text', () => {
    const out = applyPublishedContent(unpublishedBase(sampleContent), [page('about', [{ type: 'text', heading: 'x', body: '', visible: false }])]);
    expect(out.publishedPages.about).toBe(false);
  });

  it('maps New Here welcome points and questions, and skips hidden sections', () => {
    const out = applyPublishedContent(unpublishedBase(sampleContent), [page('new_here', [
      { type: 'text', heading: 'Friendly people', body: 'We remember names.', visible: true },
      { type: 'text', heading: 'Hidden', body: 'Not shown.', visible: false },
      { type: 'faq', heading: 'Do I need to know the Bible?', body: 'No.', visible: true },
    ])]);
    expect(out.newHere.welcomePoints).toEqual([{ title: 'Friendly people', text: 'We remember names.' }]);
    expect(out.newHere.faqs).toEqual([{ question: 'Do I need to know the Bible?', answer: 'No.' }]);
    expect(out.publishedPages.newHere).toBe(true);
  });
});

describe('Foundation School shows no sample copy when published', () => {
  it('renders only the published headline and intro, never the Phase C sample sections', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(String(url).includes('v_public_content') ? [{
      kind: 'page', key: 'foundation_school', body: { title: 'Foundation School', sections: [{ type: 'text', heading: '', body: 'Published intro.', visible: true }] },
      version_no: 1, published_at: '2026-10-01T00:00:00Z',
    }] : [])));
    render(
      <MemoryRouter initialEntries={['/foundation-school']}>
        <PublishedApp config={CONFIG_NO_TURNSTILE} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Published intro.')).toBeInTheDocument());
    const fs = sampleContent.foundationSchool;
    for (const sample of [fs.whatItIs, fs.learn[0].title, fs.journey[0].title, fs.benefits[0], fs.faqs[0].question]) {
      expect(screen.queryByText(sample)).toBeNull();
    }
    expect(screen.queryByText('What participants will learn')).toBeNull();
    expect(screen.queryByText('Frequently asked questions')).toBeNull();
  });
});
