// Website Management sign-in. The project uses Google OAuth only (AGENTS.md). After Google redirects back, Supabase Auth
// returns the access token in the URL fragment. The token is kept in memory and in sessionStorage (cleared when the tab
// closes). It is never written to localStorage, and it is never placed in a URL.
import type { PublicApiConfig } from '../api/config';

const KEY = 'blwyork.website.session';
let memoryToken: string | null = null;

/** Extracts an access token from a Supabase redirect fragment such as "#access_token=...&expires_in=3600". */
export function parseAccessTokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('access_token');
  return token && /^[A-Za-z0-9._-]{20,4096}$/.test(token) ? token : null;
}

export function buildGoogleSignInUrl(config: PublicApiConfig, redirectTo: string): string {
  return `${config.url.replace(/\/$/, '')}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

export function setSessionToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked (private windows). The in-memory token still works for this page.
  }
}

export function getSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const stored = sessionStorage.getItem(KEY);
    memoryToken = stored;
    return stored;
  } catch {
    return null;
  }
}
