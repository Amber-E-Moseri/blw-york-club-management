/**
 * What the address bar says about a password-recovery callback. Read once at page load, before the Supabase client
 * consumes the hash. Tokens are never returned: the implicit-flow tokens stay in the client, and only the one-time
 * PKCE code or token hash is kept long enough to exchange it.
 */
export type RecoveryLink =
  | { kind: 'none' }
  | { kind: 'implicit' }
  | { kind: 'pkce'; code: string }
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'expired' }
  | { kind: 'invalid' };

const EXPIRED_CODES = new Set(['otp_expired', 'token_expired']);

export function parseRecoveryLink(hash: string, search: string): RecoveryLink {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const query = new URLSearchParams(search.replace(/^\?/, ''));

  const errorCode = fragment.get('error_code') ?? query.get('error_code');
  if (errorCode) return EXPIRED_CODES.has(errorCode) ? { kind: 'expired' } : { kind: 'invalid' };
  if (fragment.get('error') || query.get('error')) return { kind: 'invalid' };

  const code = query.get('code');
  if (code) return { kind: 'pkce', code };

  const tokenHash = query.get('token_hash');
  if (tokenHash && query.get('type') === 'recovery') return { kind: 'token_hash', tokenHash };

  if (fragment.get('type') === 'recovery' && fragment.get('access_token')) return { kind: 'implicit' };

  return { kind: 'none' };
}
