import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../components/foundation/Button';
import { confirmLink } from '../lib/supabase';
import { establishConfirmSession, type ConfirmStatus } from '../lib/auth';

type Stage = 'checking' | ConfirmStatus;

const UNUSABLE_LINK_COPY: Record<Exclude<Stage, 'checking' | 'confirmed'>, string> = {
  expired:
    'This confirmation link has expired or has already been used. Request a new one by signing up again, or contact a leader.',
  invalid: 'This confirmation link is not valid. Request a new one by signing up again, or contact a leader.',
  missing: 'No confirmation link found. Click the link in your confirmation email to verify your address.',
};

export const ConfirmEmail: React.FC = () => {
  const [stage, setStage] = useState<Stage>('checking');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    establishConfirmSession(confirmLink).then(setStage, () => setStage('invalid'));
  }, []);

  const goToSignIn = () => { window.location.replace('/'); };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-md p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">Confirm your email</h1>

        {stage === 'checking' && (
          <p role="status" className="text-sm text-gray-600 dark:text-slate-300">
            Verifying your email address…
          </p>
        )}

        {stage === 'confirmed' && (
          <div className="space-y-4">
            <p role="status" className="text-sm text-gray-700 dark:text-slate-200">
              Your email address has been confirmed. A leader will approve your account before you can access the hub.
              You'll receive a notification once you're approved.
            </p>
            <Button type="button" fullWidth onClick={goToSignIn}>
              Go to sign in
            </Button>
          </div>
        )}

        {stage !== 'checking' && stage !== 'confirmed' && (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-gray-700 dark:text-slate-200">
              {UNUSABLE_LINK_COPY[stage as Exclude<Stage, 'checking' | 'confirmed'>]}
            </p>
            <Button type="button" fullWidth onClick={goToSignIn}>
              Back to sign in
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
