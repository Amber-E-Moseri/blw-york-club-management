import React, { useState } from 'react';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { AuthError, resetPassword, verifyEmailOtp } from '../lib/auth';
import { isConfigured } from '../lib/supabase';

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string, fullName: string, studentNumber?: string) => Promise<boolean>;
  error: string | null;
  loading: boolean;
}

type ResetNotice = 'invalid' | 'sent' | 'rate' | 'failed';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The same message for a known and an unknown address, so the form does not reveal which accounts exist.
const RESET_NOTICE_TEXT: Record<ResetNotice, string> = {
  invalid: 'Enter a valid email address.',
  sent: 'If an account exists for that email, we have sent a password reset link. Check your inbox and spam folder, and use the newest link.',
  rate: 'Too many reset requests. Wait a few minutes, then try again.',
  failed: 'We could not send the reset email right now. Try again later.',
};

function isRateLimited(err: unknown): boolean {
  return err instanceof AuthError && /rate limit|security purposes|too many/i.test(err.code ?? err.message);
}

export const Login: React.FC<LoginProps> = ({ onSignIn, onSignUp, error, loading }) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'verify' | 'done' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [localError, setLocalError] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState<ResetNotice | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState('');

  const openForgotPassword = () => {
    setMode('forgot');
    setResetEmail(email);
    setResetNotice(null);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetBusy) return;
    const address = resetEmail.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setResetNotice('invalid');
      return;
    }
    setResetBusy(true);
    setResetNotice(null);
    try {
      await resetPassword(address);
      setResetNotice('sent');
    } catch (err) {
      setResetNotice(isRateLimited(err) ? 'rate' : 'failed');
    } finally {
      setResetBusy(false);
    }
  };

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
    if (ok) { setOtpCode(''); setOtpError(''); setMode('verify'); }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpBusy) return;
    const code = otpCode.trim();
    if (!/^\d{6}$/.test(code)) { setOtpError('Enter the 6-digit code from the email.'); return; }
    setOtpBusy(true);
    setOtpError('');
    try {
      await verifyEmailOtp(email, code);
      setMode('done');
    } catch (err) {
      setOtpError(err instanceof AuthError ? err.message : 'Invalid or expired code. Try again.');
    } finally {
      setOtpBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="BLW York" className="w-14 h-14 object-contain" />
            <div>
              <p className="text-lg font-bold text-gray-900">BLW York Hub</p>
              <p className="text-sm text-gray-400">York University</p>
            </div>
          </div>
        </div>

        {!isConfigured && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md px-4 py-3 text-sm text-yellow-800 mb-4">
            <strong>Setup required.</strong> Add your Supabase URL and anon key to .env
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-8">

          {/* Email OTP verification */}
          {mode === 'verify' && (
            <>
              <h2 className="text-xl font-bold text-center mb-2">Check your email</h2>
              <p className="text-sm text-gray-500 text-center mb-5">
                We sent a 6-digit code to <strong>{email}</strong>. Enter it below to confirm your address.
              </p>
              <form className="space-y-4" onSubmit={handleVerify} noValidate>
                <Input
                  label="Verification code"
                  value={otpCode}
                  onChange={(v) => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  error={otpError || undefined}
                />
                <Button fullWidth loading={otpBusy} disabled={otpBusy} type="submit">Verify</Button>
              </form>
              <p className="text-center text-sm text-gray-500 mt-5">
                <button type="button" onClick={() => { setMode('signin'); setOtpCode(''); setOtpError(''); }} className="text-york-600 font-semibold hover:underline">
                  Back to Sign In
                </button>
              </p>
            </>
          )}

          {/* Sign-up success */}
          {mode === 'done' && (
            <div className="text-center space-y-4">
              <div className="text-4xl">🍁</div>
              <h2 className="text-xl font-bold text-gray-900">Application submitted!</h2>
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
                <div className="flex justify-end -mt-2">
                  <button type="button" onClick={openForgotPassword} className="text-xs text-york-600 dark:text-york-400 font-semibold hover:underline">
                    Forgot password?
                  </button>
                </div>
                {(error || localError) && (
                  <p className="text-xs text-red-600" role="alert">{error || localError}</p>
                )}
                <Button fullWidth loading={loading} type="submit">Sign In</Button>
              </form>
              <p className="text-center text-sm text-gray-500 mt-5">
                New to BLW York?{' '}
                <button type="button" onClick={() => { setMode('signup'); setLocalError(''); }} className="text-york-600 font-semibold hover:underline">
                  Request access
                </button>
              </p>
            </>
          )}

          {/* Forgot password */}
          {mode === 'forgot' && (
            <>
              <h2 className="text-xl font-bold text-center mb-2 text-gray-900 dark:text-slate-100">Reset your password</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 text-center mb-4">
                Enter the email address for your account. We will send a link to choose a new password.
              </p>
              <form className="space-y-4" onSubmit={handleForgotPassword} noValidate>
                <Input label="Email" type="email" value={resetEmail} onChange={setResetEmail} placeholder="you@yorku.ca" autoComplete="email" />
                {resetNotice && (
                  <p
                    className="text-xs text-york-600 dark:text-york-400"
                    role={resetNotice === 'sent' ? 'status' : 'alert'}
                  >
                    {RESET_NOTICE_TEXT[resetNotice]}
                  </p>
                )}
                {resetNotice !== 'sent' && (
                  <Button fullWidth loading={resetBusy} disabled={resetBusy} type="submit">Send reset link</Button>
                )}
              </form>
              <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-5">
                <button type="button" onClick={() => { setMode('signin'); setResetNotice(null); }} className="text-york-600 dark:text-york-400 font-semibold hover:underline">
                  Back to Sign In
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
                  <p className="text-xs text-red-600" role="alert">{error || localError}</p>
                )}
                <Button fullWidth loading={loading} type="submit">Submit Request</Button>
              </form>
              <p className="text-center text-sm text-gray-500 mt-5">
                Already have an account?{' '}
                <button type="button" onClick={() => { setMode('signin'); setLocalError(''); }} className="text-york-600 font-semibold hover:underline">
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
