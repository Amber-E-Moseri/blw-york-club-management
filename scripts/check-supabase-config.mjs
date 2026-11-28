// Build-time guard for the Supabase connection of the unified platform. Run before any site or Hub build.
// The public website reads VITE_SUPABASE_* and the Hub reads REACT_APP_SUPABASE_*. Both must name the same project
// with the same anon key, and a Preview build must never reach the protected production project.
// Exits non-zero on any violation so a misconfigured deployment cannot be built.

export const PROTECTED_PRODUCTION_REF = 'rjtstjmtddqhesexltbj';

/** Returns the project ref from https://<ref>.supabase.co, or null for anything else. */
export function projectRef(url) {
  const value = (url ?? '').trim().replace(/\/+$/, '');
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && !(u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return null;
    if (u.username || u.password) return null;
    const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
    return m ? m[1] : u.hostname;
  } catch {
    return null;
  }
}

/** Returns a list of human-readable violations. An empty list means the configuration is acceptable. */
export function checkSupabaseConfig(env) {
  const problems = [];
  const siteUrl = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const hubUrl = (env.REACT_APP_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const siteKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const hubKey = (env.REACT_APP_SUPABASE_ANON_KEY ?? '').trim();
  const vercelEnv = (env.VERCEL_ENV ?? '').trim();
  const expectedPreview = (env.EXPECTED_PREVIEW_SUPABASE_REF ?? '').trim();
  const demo = (env.VITE_PREVIEW_DEMO ?? '').trim() === 'true';

  if (siteUrl && hubUrl && projectRef(siteUrl) !== projectRef(hubUrl)) {
    problems.push('VITE_SUPABASE_URL and REACT_APP_SUPABASE_URL name different projects. Set both to the same project.');
  }
  if (siteKey && hubKey && siteKey !== hubKey) {
    problems.push('VITE_SUPABASE_ANON_KEY and REACT_APP_SUPABASE_ANON_KEY differ. Set both to the same project anon key.');
  }
  if (!siteUrl !== !siteKey) {
    problems.push('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set together.');
  }
  if (!hubUrl !== !hubKey) {
    problems.push('REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY must be set together.');
  }

  const refs = [siteUrl, hubUrl].filter(Boolean).map(projectRef);
  if (vercelEnv === 'preview') {
    if (refs.includes(PROTECTED_PRODUCTION_REF)) {
      problems.push(`Preview build points at the protected production project (${PROTECTED_PRODUCTION_REF}). Refusing to build.`);
    }
    if (expectedPreview && refs.some((r) => r !== expectedPreview)) {
      problems.push(`Preview build must use the approved isolated project (${expectedPreview}).`);
    }
  }
  if (vercelEnv === 'production' && demo) {
    problems.push('VITE_PREVIEW_DEMO=true is set for a production build. Demo content must never reach production.');
  }
  return problems;
}

// CLI entry point.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-supabase-config.mjs')) {
  const problems = checkSupabaseConfig(process.env);
  if (problems.length > 0) {
    for (const p of problems) console.error(`Supabase configuration error: ${p}`);
    process.exit(1);
  }
  console.log('Supabase configuration check passed.');
}
