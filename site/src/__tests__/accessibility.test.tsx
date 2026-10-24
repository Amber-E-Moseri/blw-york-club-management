import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import App from '../App';
import { PublishedApp } from '../content/PublishedApp';
import { MediaScreen } from '../admin/MediaScreen';
import type { WebsiteApi } from '../api/websiteApi';
import type { WebsitePermission } from '../admin/permissions';

// Colour contrast cannot be measured in jsdom (no layout engine), so it is checked in the browser pass instead.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, AXE_OPTIONS);
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`).join('\n');
  expect(summary).toBe('');
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const PUBLIC_ROUTES = ['/', '/about', '/events', '/rhapsody', '/foundation-school', '/blog', '/new-here', '/contact', '/no-such-page'];

describe('public pages (demo content, development)', () => {
  for (const route of PUBLIC_ROUTES) {
    it(`has no detectable accessibility violations on ${route}`, async () => {
      const { container } = render(
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>,
      );
      await expectNoViolations(container);
    });
  }
});

describe('public states', () => {
  it('the production unavailable page has no violations', async () => {
    vi.stubEnv('PROD', true);
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <PublishedApp config={null} />
      </MemoryRouter>,
    );
    await expectNoViolations(container);
  });

  it('the connected loading and pending pages have no violations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
    const { container } = render(
      <MemoryRouter initialEntries={['/about']}>
        <PublishedApp config={{ url: 'https://p.example.co', anonKey: 'anon-key-value', turnstileSiteKey: null }} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/being prepared/)).toBeInTheDocument());
    await expectNoViolations(container);
  });
});

describe('dashboard workflows', () => {
  it('the media upload screen has no detectable violations', async () => {
    const api = {
      listMedia: async () => [],
      uploadMedia: async () => 'path',
    } as unknown as WebsiteApi;
    const perms = new Set<WebsitePermission>(['website.media.upload', 'website.rhapsody.manage']);
    const { container } = render(
      <MemoryRouter>
        <MediaScreen api={api} perms={perms} />
      </MemoryRouter>,
    );
    await screen.findByText(/No files uploaded yet/);
    await expectNoViolations(container);
  });
});
