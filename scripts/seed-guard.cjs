// Fail-closed guard for scripts that create test accounts (create-test-users.js).
//
// The seed script writes accounts with status 'active' and a privileged role. Running it against the production
// database would create real, privileged accounts that count as members. The guard refuses to run unless every
// condition below holds. It never guesses: an unset or unrecognised value is a refusal.
//
//   1. SUPABASE_URL is a valid URL whose host is on the allowlist (default: localhost and 127.0.0.1 only).
//      A hosted test environment must be added explicitly through TEST_SEED_ALLOWED_HOSTS.
//   2. The URL does not reference either protected BLW York project ref (production or preview). This check is not
//      overridable by env.
//   3. NODE_ENV is not 'production'.
//   4. TEST_SEED_CONFIRM equals the exact confirmation string, so the run is deliberate.
//   5. TEST_USER_PASSWORD is set and at least 10 characters.
//
// This module has no side effects so it can be unit-tested (scripts/__tests__/seed-guard.test.cjs).

'use strict';

// The two BLW York project references. Both are refused by name, and neither can be overridden by environment.
//   rjtstjmtddqhesexltbj  Production. Confirmed from the Vercel Production environment (REACT_APP_SUPABASE_URL) and
//                         the live production bundle at blwyork.vercel.app.
//   yziuhtxtznginhdpqurb  Preview. Confirmed from the Vercel Preview environment (REACT_APP_SUPABASE_URL).
// Until each one's authorized use is verified, neither may receive automated writes, and test accounts are never created
// in either. Earlier versions of this guard listed only yziu... as "production", which left rjtst... unprotected.
const PROTECTED_PROJECT_REFS = Object.freeze(['rjtstjmtddqhesexltbj', 'yziuhtxtznginhdpqurb']);

const DEFAULT_ALLOWED_HOSTS = Object.freeze(['localhost', '127.0.0.1']);

const REQUIRED_CONFIRMATION = 'CREATE_TEST_ACCOUNTS_IN_NON_PRODUCTION';

const MIN_PASSWORD_LENGTH = 10;

/**
 * Returns { ok, errors, host }. `ok` is true only when there are no errors.
 * @param {Record<string, string | undefined>} env  Normally process.env.
 */
function assertSafeSeedTarget(env) {
  const errors = [];
  const rawUrl = env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL || '';
  let host = null;

  if (!rawUrl) {
    errors.push('SUPABASE_URL is not set.');
  } else {
    try {
      host = new URL(rawUrl).hostname.toLowerCase();
    } catch {
      errors.push('SUPABASE_URL is not a valid URL.');
    }
  }

  if (env.NODE_ENV === 'production') {
    errors.push('NODE_ENV=production is refused.');
  }

  if (rawUrl && PROTECTED_PROJECT_REFS.some((ref) => rawUrl.toLowerCase().includes(ref))) {
    errors.push('SUPABASE_URL references a protected BLW York project (production or preview). Refused, and not overridable.');
  }

  const allowed = env.TEST_SEED_ALLOWED_HOSTS
    ? env.TEST_SEED_ALLOWED_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
    : [...DEFAULT_ALLOWED_HOSTS];
  if (host !== null && !allowed.includes(host)) {
    errors.push(`Host "${host}" is not on the test-seed allowlist.`);
  }

  if (env.TEST_SEED_CONFIRM !== REQUIRED_CONFIRMATION) {
    errors.push(`TEST_SEED_CONFIRM must equal ${REQUIRED_CONFIRMATION}.`);
  }

  if (!env.TEST_USER_PASSWORD || env.TEST_USER_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    errors.push(`TEST_USER_PASSWORD must be set and at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  return { ok: errors.length === 0, errors, host };
}

module.exports = {
  assertSafeSeedTarget,
  PROTECTED_PROJECT_REFS,
  DEFAULT_ALLOWED_HOSTS,
  REQUIRED_CONFIRMATION,
  MIN_PASSWORD_LENGTH,
};
