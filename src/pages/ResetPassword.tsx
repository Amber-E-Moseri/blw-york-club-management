import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { changePassword, establishRecoverySession, signOut, type RecoveryStatus } from '../lib/auth';
import { recoveryLink } from '../lib/supabase';

// Same minimum as sign-up and sign-in (Login.tsx and lib/auth.ts).
const MIN_PASSWORD_LENGTH = 6;

type Stage = 'checking' | 'done' | RecoveryStatus;

const UNUSABLE_LINK_COPY: Record<Exclude<RecoveryStatus, 'ready'>, string> = {
  missing: 'Open the password reset link from your email to choose a new password.',
  expired:
    'This reset link has expired, has already been used, or was opened in another browser. Request a new password reset email and use the newest link.',
  invalid: 'This reset link is not valid. Request a new password reset email and use the newest link.',
};

/**
 * Reached from the link in a password reset email. It is public: App renders it before the sign-in gate, so a
 * recovery session never falls through to the main app. A password change needs a valid recovery session, and this
 * page never submits without one.
 */
export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // A PKCE code can be exchanged only once. The guard keeps a development double-mount from exchanging it twice.
    if (started.current) return;
    started.current = true;
    // Remove the code or tokens from the address bar, so they stay out of history and shared links.
    window.history.replaceState(null, '', window.location.pathname);
    establishRecoverySession(recoveryLink).then(setStage, () => setStage('invalid'));
  }, []);

  const backToSignIn = async () => {
    try {
      await signOut();
    } catch {
      // Nothing to end if there is no session.
    }
    navigate('/', { replace: true });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (stage !== 'ready' || busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(password);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'We could not update your password. Try again.');
      return;
    }
    // End the recovery session, so the user signs in again with the new password.
    try {
      await signOut();
    } catch {
      // The password is already changed. The session expires on its own.
    }
    setPassword('');
    setConfirm('');
    setBusy(false);
    setStage('done');
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-md p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">Choose a new password</h1>

        {stage === 'checking' && (
          <p role="status" className="text-sm text-gray-600 dark:text-slate-300">
            Checking your reset link…
          </p>
        )}

        {stage === 'ready' && (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Input
              label="New password"
              type="password"
              value={password}
              onChange={setPassword}
              minLength={MIN_PASSWORD_LENGTH}
              required
              autoComplete="new-password"
              name="new-password"
            />
            <Input
              label="Confirm new password"
              type="password"
              value={confirm}
              onChange={setConfirm}
              minLength={MIN_PASSWORD_LENGTH}
              required
              autoComplete="new-password"
              name="confirm-password"
            />
            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <Button type="submit" fullWidth loading={busy} disabled={busy}>
              Update password
            </Button>
            <Button type="button" variant="ghost" fullWidth onClick={backToSignIn} disabled={busy}>
              Back to sign in
            </Button>
          </form>
        )}

        {stage === 'done' && (
          <div className="space-y-4">
            <p role="status" className="text-sm text-gray-700 dark:text-slate-200">
              Your password has been updated. Sign in with your new password.
            </p>
            <Button type="button" fullWidth onClick={() => navigate('/', { replace: true })}>
              Go to sign in
            </Button>
          </div>
        )}

        {stage !== 'checking' && stage !== 'ready' && stage !== 'done' && (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-gray-700 dark:text-slate-200">
              {UNUSABLE_LINK_COPY[stage]}
            </p>
            <Button type="button" fullWidth onClick={backToSignIn}>
              Back to sign in
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
