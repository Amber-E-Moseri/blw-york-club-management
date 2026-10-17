import { parseRecoveryLink } from '../lib/recoveryLink';

describe('parseRecoveryLink', () => {
  test('implicit-flow recovery tokens in the fragment are recognised without returning them', () => {
    const link = parseRecoveryLink('#access_token=AT&refresh_token=RT&type=recovery&expires_in=3600', '');
    expect(link).toEqual({ kind: 'implicit' });
    expect(JSON.stringify(link)).not.toMatch(/AT|RT/);
  });

  test('a PKCE code in the query is kept for a single exchange', () => {
    expect(parseRecoveryLink('', '?code=pkce-code-123')).toEqual({ kind: 'pkce', code: 'pkce-code-123' });
  });

  test('a token hash with type=recovery is supported', () => {
    expect(parseRecoveryLink('', '?token_hash=TH&type=recovery')).toEqual({ kind: 'token_hash', tokenHash: 'TH' });
  });

  test('a token hash for another type is not a recovery link', () => {
    expect(parseRecoveryLink('', '?token_hash=TH&type=signup')).toEqual({ kind: 'none' });
  });

  test('an expired link is reported as expired', () => {
    expect(parseRecoveryLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+expired', '')).toEqual({
      kind: 'expired',
    });
  });

  test('any other error is reported as invalid', () => {
    expect(parseRecoveryLink('#error=server_error&error_code=unexpected_failure', '')).toEqual({ kind: 'invalid' });
    expect(parseRecoveryLink('', '?error=access_denied')).toEqual({ kind: 'invalid' });
  });

  test('tokens without type=recovery are not treated as a recovery link', () => {
    expect(parseRecoveryLink('#access_token=AT&type=signup', '')).toEqual({ kind: 'none' });
  });

  test('an ordinary page load is no link at all', () => {
    expect(parseRecoveryLink('', '')).toEqual({ kind: 'none' });
    expect(parseRecoveryLink('', '?tab=profile')).toEqual({ kind: 'none' });
  });
});
