// Typed, fail-fast validation of the local Supabase environment used by the browser E2E suites.
// Every value is narrowed to `string` here, so callers never need non-null assertions or re-checks inside closures.

export interface LocalSupabaseEnv {
  url: string;
  anonKey: string;
  serviceKey: string;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

/** Reads and validates the local stack configuration. Refuses any host that is not loopback. */
export function localSupabaseEnv(): LocalSupabaseEnv {
  const url = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error('this E2E suite only runs against a local Supabase stack (SUPABASE_URL must be on 127.0.0.1 or localhost)');
  }
  return { url, anonKey, serviceKey };
}
