import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGoogleSignInUrl, getSessionToken, parseAccessTokenFromHash, setSessionToken, signInWithPassword } from '../admin/session';

describe('sign-in redirect', () => {
  it('reads the access token from the fragment', () => {
    const t = 'eyJhbGciOiJIUzI1NiJ9.payload-part.signature-part';
    expect(parseAccessTokenFromHash(`#access_token=${t}&expires_in=3600&token_type=bearer`)).toBe(t);
  });

  it('ignores fragments without a plausible token', () => {
    expect(parseAccessTokenFromHash('#error=access_denied')).toBeNull();
    expect(parseAccessTokenFromHash('#access_token=short')).toBeNull();
    expect(parseAccessTokenFromHash('#access_token=has spaces in it and is long enough')).toBeNull();
    expect(parseAccessTokenFromHash('')).toBeNull();
  });

  it('builds a Google-only sign-in URL that returns to the admin area', () => {
    const url = buildGoogleSignInUrl({ url: 'https://p.example.co/', anonKey: 'k' }, 'https://site.example/admin');
    expect(url).toBe('https://p.example.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fsite.example%2Fadmin');
    expect(url).not.toMatch(/provider=(email|password|phone)/);
  });
});

describe('session token storage', () => {
  beforeEach(() => setSessionToken(null));

  it('keeps the token in memory and in sessionStorage, never in localStorage', () => {
    setSessionToken('a-token-long-enough-to-look-real-123');
    expect(getSessionToken()).toBe('a-token-long-enough-to-look-real-123');
    expect(sessionStorage.getItem('blwyork.website.session')).toBe('a-token-long-enough-to-look-real-123');
    expect(localStorage.getItem('blwyork.website.session')).toBeNull();
  });

  it('clears the token on sign-out', () => {
    setSessionToken('a-token-long-enough-to-look-real-123');
    setSessionToken(null);
    expect(getSessionToken()).toBeNull();
    expect(sessionStorage.getItem('blwyork.website.session')).toBeNull();
  });
});

describe('email and password sign-in', () => {
  const config = { url: 'https://p.example.co/', anonKey: 'k' };

  it('stores the access token from the password grant and keeps the password out of the URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'a'.repeat(32) }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await signInWithPassword(config, 'admin@example.org', 'correct-horse');
      expect(getSessionToken()).toBe('a'.repeat(32));
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://p.example.co/auth/v1/token?grant_type=password');
      expect(url).not.toContain('correct-horse');
      expect(String(init.body)).toContain('correct-horse');
    } finally {
      vi.unstubAllGlobals();
      setSessionToken(null);
    }
  });

  it('refuses a failed sign-in without storing anything, and does not say which field was wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));
    setSessionToken(null);
    try {
      await expect(signInWithPassword(config, 'x@example.org', 'wrong')).rejects.toThrow('That email and password did not work.');
      expect(getSessionToken()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
