// Proves how establishRecoverySession maps each callback to a status, using a stubbed Supabase Auth client. It does not
// run GoTrue, so it shows the mapping and the no-logging rule, not Supabase's own answers.
jest.mock('../lib/supabase', () => {
  const auth = {
    exchangeCodeForSession: jest.fn(),
    verifyOtp: jest.fn(),
    getSession: jest.fn(),
  };
  return { supabase: { auth, from: jest.fn(), rpc: jest.fn() }, isConfigured: false, recoveryLink: { kind: 'none' } };
});

import { establishRecoverySession } from '../lib/auth';
import { supabase } from '../lib/supabase';

const mockAuth = (supabase as unknown as { auth: Record<'exchangeCodeForSession' | 'verifyOtp' | 'getSession', jest.Mock> }).auth;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('establishRecoverySession', () => {
  test('a PKCE code is exchanged once and reports ready on success', async () => {
    mockAuth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    await expect(establishRecoverySession({ kind: 'pkce', code: 'CODE-1' })).resolves.toBe('ready');
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith('CODE-1');
  });

  test('a PKCE code that fails to exchange reports expired', async () => {
    mockAuth.exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: 'invalid code' } });
    await expect(establishRecoverySession({ kind: 'pkce', code: 'USED' })).resolves.toBe('expired');
  });

  test('a token hash is verified as a recovery and reports ready on success', async () => {
    mockAuth.verifyOtp.mockResolvedValue({ data: {}, error: null });
    await expect(establishRecoverySession({ kind: 'token_hash', tokenHash: 'TH' })).resolves.toBe('ready');
    expect(mockAuth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'TH' });
  });

  test('a token hash that fails to verify reports expired', async () => {
    mockAuth.verifyOtp.mockResolvedValue({ data: null, error: { message: 'token expired' } });
    await expect(establishRecoverySession({ kind: 'token_hash', tokenHash: 'TH' })).resolves.toBe('expired');
  });

  test('an implicit recovery is ready only when the client holds a session', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null });
    await expect(establishRecoverySession({ kind: 'implicit' })).resolves.toBe('ready');

    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(establishRecoverySession({ kind: 'implicit' })).resolves.toBe('expired');
  });

  test('no link, expired and invalid links never touch Supabase', async () => {
    await expect(establishRecoverySession({ kind: 'none' })).resolves.toBe('missing');
    await expect(establishRecoverySession({ kind: 'expired' })).resolves.toBe('expired');
    await expect(establishRecoverySession({ kind: 'invalid' })).resolves.toBe('invalid');
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockAuth.verifyOtp).not.toHaveBeenCalled();
    expect(mockAuth.getSession).not.toHaveBeenCalled();
  });

  test('the code and token hash are never written to the console', async () => {
    const logs: unknown[][] = [];
    const spies = ['debug', 'log', 'info', 'warn', 'error'].map((level) =>
      jest.spyOn(console, level as 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );
    mockAuth.exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: 'bad' } });
    mockAuth.verifyOtp.mockResolvedValue({ data: null, error: { message: 'bad' } });
    await establishRecoverySession({ kind: 'pkce', code: 'SECRET-CODE' });
    await establishRecoverySession({ kind: 'token_hash', tokenHash: 'SECRET-HASH' });
    spies.forEach((spy) => spy.mockRestore());
    expect(JSON.stringify(logs)).not.toMatch(/SECRET-/);
  });
});
