// Website Management sign-in with Supabase email and password. Google sign-in is deferred and not used here. The token is
// kept in memory and in sessionStorage (cleared when the tab closes). It is never written to localStorage, never placed in
// a URL, and the password is sent only in a request body. Authorization is decided by the database, not by this file.
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

/**
 * Signs in with email and password through the Supabase password grant. The password is never stored or logged, and the
 * error message does not say which part was wrong.
 */
export async function signInWithPassword(config: PublicApiConfig, email: string, password: string): Promise<void> {
  const res = await fetch(`${config.url.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  const token = typeof body?.access_token === 'string' ? body.access_token : null;
  if (!res.ok || !token || !/^[A-Za-z0-9._-]{20,4096}$/.test(token)) {
    throw new Error('That email and password did not work. Check them and try again.');
  }
  setSessionToken(token);
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
