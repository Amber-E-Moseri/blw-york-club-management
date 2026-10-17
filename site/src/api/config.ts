// Runtime configuration for the website service. Read at build time from Vite env. The anon key is public by design;
// it is safe in the browser because every table is protected by row-level security and every write goes through an RPC.
// The service-role key must never be configured here.

export interface PublicApiConfig {
  url: string;
  anonKey: string;
  /** When set, public inquiries go through the protected Edge Function with a Turnstile check. */
  turnstileSiteKey?: string | null;
}

export function readApiConfig(env: Record<string, string | undefined>): PublicApiConfig | null {
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  if (!/^https:\/\/[^\s/]+\.[^\s/]+$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) return null;
  // Refuse anything that looks like a service-role key (its JWT payload carries "role":"service_role").
  if (decodeRole(anonKey) === 'service_role') return null;
  const turnstileSiteKey = (env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
  return { url: url.replace(/\/+$/, ''), anonKey, turnstileSiteKey: /^[0-9A-Za-z_-]{8,80}$/.test(turnstileSiteKey) ? turnstileSiteKey : null };
}

/** Reads the role claim from a JWT payload without verifying it. Used only to refuse a service-role key. */
export function decodeRole(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}
