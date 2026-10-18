/**
 * What the address bar says about an email-confirmation callback. Read once at page load, before the Supabase client
 * consumes the hash or code. Only the link kind and a PKCE code or token hash are kept.
 */
export type ConfirmLink =
  | { kind: 'none' }
  | { kind: 'pkce'; code: string }
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'expired' }
  | { kind: 'invalid' };

const EXPIRED_CODES = new Set(['otp_expired', 'token_expired']);

export function parseConfirmLink(hash: string, search: string): ConfirmLink {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const query = new URLSearchParams(search.replace(/^\?/, ''));

  const errorCode = fragment.get('error_code') ?? query.get('error_code');
  if (errorCode) return EXPIRED_CODES.has(errorCode) ? { kind: 'expired' } : { kind: 'invalid' };
  if (fragment.get('error') || query.get('error')) return { kind: 'invalid' };

  const code = query.get('code');
  if (code) return { kind: 'pkce', code };

  const tokenHash = query.get('token_hash');
  const type = query.get('type');
  if (tokenHash && (type === 'email' || type === 'signup')) {
    return { kind: 'token_hash', tokenHash };
  }

  return { kind: 'none' };
}
