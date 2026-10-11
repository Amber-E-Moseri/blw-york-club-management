import React, { useState } from 'react';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { isConfigured } from '../lib/supabase';

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string, fullName: string, studentNumber?: string) => Promise<boolean>;
  error: string | null;
  loading: boolean;
}

export const Login: React.FC<LoginProps> = ({ onSignIn, onSignUp, error, loading }) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'done'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [localError, setLocalError] = useState('');

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    onSignIn(email, password);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (!fullName.trim()) { setLocalError('Full name is required.'); return; }
    if (password.length < 6) { setLocalError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setLocalError('Passwords do not match.'); return; }
    const ok = await onSignUp(email, password, fullName.trim(), studentNumber.trim() || undefined);
    if (ok) setMode('done');
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="BLW York" className="w-14 h-14 object-contain" />
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-slate-100">BLW York Hub</p>
              <p className="text-sm text-gray-400">York University</p>
            </div>
          </div>
        </div>

        {!isConfigured && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md px-4 py-3 text-sm text-yellow-800 mb-4">
            <strong>Setup required.</strong> Add your Supabase URL and anon key to .env
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8">

          {/* Sign-up success */}
          {mode === 'done' && (
            <div className="text-center space-y-4">
              <img src="/logo.png" alt="" className="w-14 h-14 mx-auto" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Application submitted!</h2>
              <p className="text-sm text-gray-500">
                Your account is pending approval by a leader. You'll be able to log in once you're approved.
              </p>
              <Button variant="ghost" onClick={() => setMode('signin')}>Back to Sign In</Button>
            </div>
          )}

          {/* Sign In */}
          {mode === 'signin' && (
            <>
              <h2 className="text-xl font-bold text-center mb-5">Sign In</h2>
              <form className="space-y-5" onSubmit={handleSignIn} noValidate>
                <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@yorku.ca" autoComplete="email" />
                <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />
                {(error || localError) && (
                  <p className="text-xs text-york-600 dark:text-york-400" role="alert">{error || localError}</p>
                )}
                <Button fullWidth loading={loading} type="submit">Sign In</Button>
              </form>
              <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-5">
                New to BLW York?{' '}
                <button type="button" onClick={() => { setMode('signup'); setLocalError(''); }} className="text-york-600 dark:text-york-400 font-semibold hover:underline">
                  Request access
                </button>
              </p>
            </>
          )}

          {/* Sign Up */}
          {mode === 'signup' && (
            <>
              <h2 className="text-xl font-bold text-center mb-5">Request Access</h2>
              <form className="space-y-4" onSubmit={handleSignUp} noValidate>
                <Input label="Full Name" value={fullName} onChange={setFullName} placeholder="Your full name" autoComplete="name" required />
                <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@yorku.ca" autoComplete="email" />
                <Input label="Student Number" value={studentNumber} onChange={setStudentNumber} placeholder="e.g. 21XXXXXXX" helpText="Optional — helps leaders identify you" />
                <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="Min. 6 characters" autoComplete="new-password" />
                <Input label="Confirm Password" type="password" value={confirm} onChange={setConfirm} placeholder="••••••••" autoComplete="new-password" />
                {(error || localError) && (
                  <p className="text-xs text-york-600 dark:text-york-400" role="alert">{error || localError}</p>
                )}
                <Button fullWidth loading={loading} type="submit">Submit Request</Button>
              </form>
              <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-5">
                Already have an account?{' '}
                <button type="button" onClick={() => { setMode('signin'); setLocalError(''); }} className="text-york-600 dark:text-york-400 font-semibold hover:underline">
                  Sign in
                </button>
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
};
