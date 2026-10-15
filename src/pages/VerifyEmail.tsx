import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { resendSignupOtp, verifySignupOtp } from '../lib/auth';
import {
  OTP_LENGTH,
  clearPendingVerificationEmail,
  classifyVerificationError,
  cooldownRemainingSeconds,
  getLastResendAt,
  getPendingVerificationEmail,
  isCompleteOtp,
  maskEmail,
  sanitizeOtp,
  setLastResendAt,
  setPendingVerificationEmail,
  verificationMessage,
  type VerificationFailure,
} from '../lib/verification/emailOtp';

type Notice = { kind: 'error' | 'info'; text: string };

const EMPTY_CODE = Array.from({ length: OTP_LENGTH }, () => '');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const digitClass =
  'w-11 h-14 sm:w-12 text-center text-2xl font-semibold tabular-nums rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-york-600 disabled:opacity-60';

/**
 * Six-digit sign-up verification. Supabase Auth checks the code (verifyOtp, type 'signup'); this page never decides
 * that an account is verified. Once the session exists, App's auth gate shows the normal pending-approval screen.
 */
export const VerifyEmail: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(() => getPendingVerificationEmail());
  const [emailDraft, setEmailDraft] = useState('');
  const [digits, setDigits] = useState<string[]>(EMPTY_CODE);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastResendAt, setLastResendAtState] = useState<number | null>(() => getLastResendAt());
  const [now, setNow] = useState(() => Date.now());
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  // A ref, not state: a second submit or resend that starts before the first re-render is still refused.
  const busyRef = useRef(false);

  const cooldown = cooldownRemainingSeconds(lastResendAt, now);
  const coolingDown = cooldown > 0;

  useEffect(() => {
    if (!coolingDown) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [coolingDown]);

  const focusDigit = (index: number) => inputsRef.current[index]?.focus();

  const lock = () => {
    busyRef.current = true;
    setBusy(true);
  };
  const unlock = () => {
    busyRef.current = false;
    setBusy(false);
  };

  const submit = async (code: string) => {
    if (busyRef.current || !email || !isCompleteOtp(code)) return;
    lock();
    setNotice(null);
    try {
      await verifySignupOtp(email, code);
      clearPendingVerificationEmail();
      setVerified(true);
    } catch (e) {
      const failure = classifyVerificationError(e as { status?: number; code?: string }, 'verify');
      setNotice({ kind: 'error', text: verificationMessage(failure) });
      setDigits(EMPTY_CODE);
      focusDigit(0);
    } finally {
      unlock();
    }
  };

  /** Writes digits starting at `start`, then auto-submits when the code is complete. */
  const fillFrom = (start: number, chars: string) => {
    const next = [...digits];
    let cursor = start;
    for (const ch of chars) {
      if (cursor >= OTP_LENGTH) break;
      next[cursor] = ch;
      cursor += 1;
    }
    setDigits(next);
    focusDigit(Math.min(cursor, OTP_LENGTH - 1));
    const code = next.join('');
    if (isCompleteOtp(code)) void submit(code);
  };

  const handleChange = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (typed.length === 0) {
      setDigits((prev) => prev.map((d, i) => (i === index ? '' : d)));
      return;
    }
    // Browsers that autofill, or a keyboard that appends to a filled box, can deliver more than one new character.
    const previous = digits[index];
    const fresh = typed.length > 1 && previous ? typed.replace(previous, '') : typed;
    fillFrom(index, sanitizeOtp(fresh));
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault();
      setDigits((prev) => prev.map((d, i) => (i === index - 1 ? '' : d)));
      focusDigit(index - 1);
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusDigit(index - 1);
    } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      e.preventDefault();
      focusDigit(index + 1);
    }
  };

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = sanitizeOtp(e.clipboardData.getData('text'));
    if (text.length > 0) fillFrom(0, text);
    else focusDigit(index);
  };

  const resend = async () => {
    if (busyRef.current || coolingDown || !email) return;
    lock();
    setNotice(null);
    const sentAt = Date.now();
    try {
      await resendSignupOtp(email);
      setLastResendAt(sentAt);
      setLastResendAtState(sentAt);
      setNow(sentAt);
      setDigits(EMPTY_CODE);
      setNotice({
        kind: 'info',
        text: `A new code is on its way to ${maskEmail(email)}. It can take a minute to arrive. Check your spam folder too.`,
      });
      focusDigit(0);
    } catch (e) {
      const failure: VerificationFailure = classifyVerificationError(e as { status?: number; code?: string }, 'resend');
      if (failure === 'resend_rate_limited') {
        // Supabase has already refused this request, so start the local cooldown too.
        setLastResendAt(sentAt);
        setLastResendAtState(sentAt);
        setNow(sentAt);
      }
      setNotice({ kind: 'error', text: verificationMessage(failure) });
    } finally {
      unlock();
    }
  };

  const chooseEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = emailDraft.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setNotice({ kind: 'error', text: 'Enter the email address you signed up with.' });
      return;
    }
    setPendingVerificationEmail(trimmed);
    setEmail(trimmed);
    setEmailDraft('');
    setNotice(null);
  };

  const useDifferentEmail = () => {
    clearPendingVerificationEmail();
    setEmail(null);
    setDigits(EMPTY_CODE);
    setNotice(null);
    setLastResendAtState(null);
  };

  const code = digits.join('');

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="BLW York" className="w-14 h-14 object-contain" />
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-slate-100">BLW York Hub</p>
              <p className="text-sm text-gray-400 dark:text-slate-500">York University</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-md p-6 space-y-5">
          {verified ? (
            <div className="text-center space-y-3" role="status">
              <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Email verified</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                Thanks. Your account is now waiting for approval by a leader.
              </p>
            </div>
          ) : !email ? (
            <form className="space-y-4" onSubmit={chooseEmail} noValidate>
              <div>
                <h2 className="text-xl font-bold text-center text-gray-900 dark:text-slate-100">Verify your email</h2>
                <p className="text-sm text-center text-gray-500 dark:text-slate-400 mt-2">
                  Enter the email address you signed up with, and we will help you enter your code.
                </p>
              </div>
              <Input
                label="Email"
                type="email"
                value={emailDraft}
                onChange={setEmailDraft}
                placeholder="you@yorku.ca"
                autoComplete="email"
              />
              {notice && (
                <p className="text-xs text-york-600 dark:text-york-400" role="alert">{notice.text}</p>
              )}
              <Button fullWidth type="submit">Continue</Button>
            </form>
          ) : (
            <>
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Enter your code</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
                  We sent a six-digit code to <span className="font-medium text-gray-700 dark:text-slate-200">{maskEmail(email)}</span>.
                  Use the newest code, because older codes stop working.
                </p>
              </div>

              <fieldset disabled={busy || verified} className="space-y-4">
                <legend className="sr-only">Six-digit verification code</legend>
                <div className="flex justify-center gap-2">
                  {digits.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => { inputsRef.current[index] = el; }}
                      className={digitClass}
                      value={digit}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete={index === 0 ? 'one-time-code' : 'off'}
                      aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
                      autoFocus={index === 0}
                      onChange={(e) => handleChange(index, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(index, e)}
                      onPaste={(e) => handlePaste(index, e)}
                      onFocus={(e) => e.target.select()}
                    />
                  ))}
                </div>

                <Button fullWidth type="button" loading={busy} disabled={!isCompleteOtp(code) || busy || verified} onClick={() => void submit(code)}>
                  Verify email
                </Button>
              </fieldset>

              {notice && (
                <p
                  className={notice.kind === 'error' ? 'text-xs text-york-600 dark:text-york-400 text-center' : 'text-xs text-green-700 dark:text-green-400 text-center'}
                  role={notice.kind === 'error' ? 'alert' : 'status'}
                >
                  {notice.text}
                </p>
              )}

              <div className="text-center text-sm text-gray-500 dark:text-slate-400 space-y-2">
                <p>
                  Did not get a code?{' '}
                  <button
                    type="button"
                    onClick={() => void resend()}
                    disabled={busy || coolingDown}
                    className="text-york-600 dark:text-york-400 font-semibold hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    {coolingDown ? `Resend in ${cooldown}s` : 'Send a new code'}
                  </button>
                </p>
                <p>
                  Wrong address?{' '}
                  <button type="button" onClick={useDifferentEmail} className="text-york-600 dark:text-york-400 font-semibold hover:underline">
                    Use a different email
                  </button>
                </p>
              </div>
            </>
          )}

          <p className="text-center text-sm text-gray-500 dark:text-slate-400">
            <button type="button" onClick={() => navigate('/')} className="text-york-600 dark:text-york-400 font-semibold hover:underline">
              Back to sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
