// Typed, fail-fast validation of the Supabase environment used by the browser E2E suites.
// Every value is narrowed to `string` here, so callers never need non-null assertions or re-checks inside closures.
//
// Two targets are allowed, and nothing else:
//   1. A local stack on 127.0.0.1 or localhost (the default; see docs/e2e-hosted-isolated.md for the hosted path).
//   2. A hosted, disposable project named EXACTLY by the operator. This needs both E2E_HOSTED_ISOLATED=1 and
//      E2E_ISOLATED_HOST=<the project's hostname>. Any other host is refused, so a production URL can only be used if
//      the operator deliberately names it, which this suite never does on its own.

export interface SupabaseTestEnv {
  url: string;
  anonKey: string;
  serviceKey: string;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Reads and validates the Supabase test configuration. Refuses any target that is not loopback or explicitly allowlisted. */
export function supabaseTestEnv(): SupabaseTestEnv {
  const url = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    host = parsed.hostname;
  } catch {
    throw new Error('SUPABASE_URL must be an absolute http(s) URL');
  }

  if (!LOOPBACK_HOSTS.has(host)) {
    if (process.env.E2E_HOSTED_ISOLATED !== '1') {
      throw new Error('a non-local SUPABASE_URL needs E2E_HOSTED_ISOLATED=1 and an explicit E2E_ISOLATED_HOST');
    }
    const allowed = requireEnv('E2E_ISOLATED_HOST').toLowerCase();
    if (host.toLowerCase() !== allowed) {
      throw new Error(`SUPABASE_URL host "${host}" does not match E2E_ISOLATED_HOST; refusing to run`);
    }
  }
  return { url, anonKey, serviceKey };
}
