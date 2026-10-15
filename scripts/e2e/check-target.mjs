import { pathToFileURL } from 'node:url';

// Fail-closed guard for hosted E2E runs. Pure function plus a CLI entry point, so the failure cases can be tested
// without contacting any backend (see check-target.test.mjs). Exit code 1 on any violation.

const PROJECT_REF = /^[a-z0-9]{20}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

// The protected production project is refused unconditionally, whatever the environment says.
const PROTECTED_PRODUCTION_REF = 'rjtstjmtddqhesexltbj';
// The one disposable Preview project that may be used for hosted E2E, and only with explicit authorization.
const APPROVED_PREVIEW_REF = 'yziuhtxtznginhdpqurb';
const APPROVED_PREVIEW_HOST = `${APPROVED_PREVIEW_REF}.supabase.co`;

/** Returns a list of violations. An empty list means the target is allowed. */
export function validateTarget(env, { candidateSha } = {}) {
  const errors = [];
  const need = (name) => {
    const v = env[name];
    if (v === undefined || String(v).trim() === '') errors.push(`${name} is required`);
    return v === undefined ? '' : String(v).trim();
  };

  if (candidateSha !== undefined && !/^[0-9a-f]{40}$/.test(candidateSha)) {
    errors.push('candidate SHA must be a full 40-character lowercase commit SHA');
  }

  const url = need('SUPABASE_URL');
  need('SUPABASE_ANON_KEY');
  need('SUPABASE_SERVICE_ROLE_KEY');
  need('E2E_COORDINATOR_EMAIL');
  need('E2E_COORDINATOR_PASSWORD');

  let host = '';
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && !LOOPBACK.has(parsed.hostname.toLowerCase())) errors.push('hosted SUPABASE_URL must use https');
      if (parsed.username || parsed.password || parsed.search || parsed.hash) errors.push('SUPABASE_URL must not carry credentials, query or fragment');
      if (parsed.pathname !== '/' && parsed.pathname !== '') errors.push('SUPABASE_URL must be the bare project origin');
      host = parsed.hostname.toLowerCase();
    } catch {
      errors.push('SUPABASE_URL is not a valid URL');
    }
  }

  const isLoopback = LOOPBACK.has(host);
  if (!isLoopback) {
    if (env.E2E_HOSTED_ISOLATED !== '1') errors.push('hosted runs need E2E_HOSTED_ISOLATED=1');

    const allowed = need('E2E_ISOLATED_HOST').toLowerCase();
    if (allowed && host && host !== allowed) errors.push(`SUPABASE_URL host does not match E2E_ISOLATED_HOST`);

    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
    if (!match) errors.push('hosted host must be <20-char-ref>.supabase.co');

    // Production is refused unconditionally: by the URL, by the named isolated host, and by the Preview exception path.
    const namedHost = String(env.E2E_ISOLATED_HOST ?? '').trim().toLowerCase();
    if (match && match[1] === PROTECTED_PRODUCTION_REF) errors.push('target is the protected production project (unconditionally refused)');
    if (namedHost.includes(PROTECTED_PRODUCTION_REF)) errors.push('E2E_ISOLATED_HOST names the protected production project (unconditionally refused)');

    // Preview is refused unless this exact project is explicitly authorized for this run.
    const isPreviewHost = host === APPROVED_PREVIEW_HOST;
    const previewAuthorized =
      isPreviewHost &&
      env.E2E_PREVIEW_TESTING_AUTHORIZED === 'true' &&
      String(env.E2E_APPROVED_PREVIEW_HOST ?? '').trim().toLowerCase() === APPROVED_PREVIEW_HOST;
    if (isPreviewHost && !previewAuthorized) {
      errors.push(`Preview host requires E2E_PREVIEW_TESTING_AUTHORIZED=true and E2E_APPROVED_PREVIEW_HOST=${APPROVED_PREVIEW_HOST}`);
    }

    const denied = String(env.E2E_DENIED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (denied.length === 0) errors.push('E2E_DENIED_HOSTS must list production and Preview hosts (may not be empty)');
    // The authorized Preview host is the only exception to the denylist; production is never excepted.
    if (!previewAuthorized) {
      if (denied.includes(host)) errors.push('SUPABASE_URL host is on the production/Preview denylist');
      if (match && denied.some((d) => d.startsWith(match[1]))) errors.push('project ref matches a denylisted production/Preview entry');
    }
  }
  return errors;
}

async function main() {
  const errors = validateTarget(process.env, { candidateSha: process.env.CANDIDATE_SHA });
  if (errors.length > 0) {
    for (const e of errors) console.error(`guard: ${e}`);
    process.exit(1);
  }
  console.log('guard: target accepted');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
