import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PublishedApp } from '../content/PublishedApp';
import { sampleContent } from '../content/sample-data';

const CONFIG = { url: 'https://p.example.co', anonKey: 'anon-key-value', turnstileSiteKey: null };
const SAMPLE_LEADER = sampleContent.about.leaders[0].name;
// The home heading is split across elements, so match its first words.
const SAMPLE_HOME = /A place to grow/;
const DEMO_BANNER = /Demo preview\. Names, dates/;

function renderSite(path: string, config: typeof CONFIG | null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PublishedApp config={config} />
    </MemoryRouter>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('development demo (no backend configured)', () => {
  it('shows the sample copy with a demo banner, so it cannot pass for published information', () => {
    renderSite('/', null);
    expect(screen.getByText(DEMO_BANNER)).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_HOME)).toBeInTheDocument();
    expect(screen.getByText(/Demo preview/)).toBeInTheDocument();
  });
});

describe('production (no backend configured)', () => {
  it('shows an unavailable state and never the sample copy', () => {
    vi.stubEnv('PROD', true);
    renderSite('/', null);
    expect(screen.getByRole('heading', { name: /temporarily unavailable/ })).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_HOME)).toBeNull();
    expect(screen.queryByText(DEMO_BANNER)).toBeNull();
  });
});

describe('connected site', () => {
  it('shows a loading state first, then an unavailable state when the content service fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    renderSite('/', CONFIG);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('heading', { name: /temporarily unavailable/ })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_HOME)).toBeNull();
  });

  it('shows no sample records or demo banner when nothing has been published', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
    renderSite('/about', CONFIG);
    await waitFor(() => expect(screen.queryByText(/Loading the latest/)).toBeNull());
    expect(screen.queryByText(DEMO_BANNER)).toBeNull();
    expect(screen.queryByText(SAMPLE_LEADER)).toBeNull();
  });

  it('never sends a service-role or user token with public reads', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      return jsonResponse([]);
    }));
    renderSite('/', CONFIG);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    for (const c of calls) {
      expect(c.headers.authorization ?? 'Bearer anon-key-value').toBe('Bearer anon-key-value');
    }
  });
});
