// Pure helpers for the six-digit email verification step. No network, no storage side effects beyond the
// explicit session helpers below. Supabase Auth is the security authority: nothing here decides that an account is
// verified. The UI only uses these helpers to shape input and to explain Supabase's answer.

export const OTP_LENGTH = 6;

/** Client-side cooldown between resend requests. Supabase also rate-limits on its side (429). */
export const RESEND_COOLDOWN_SECONDS = 60;

const PENDING_EMAIL_KEY = 'blwyork.pendingVerificationEmail';
const LAST_RESEND_KEY = 'blwyork.lastVerificationResend';

/** Keeps digits only, in order, and never more than OTP_LENGTH. Used for typed input, paste and autofill. */
export function sanitizeOtp(input: string): string {
  return input.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

export function isCompleteOtp(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}

/** Shows enough of an address to recognise it, for example "m***@example.com". Never returns the full local part. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return '***';
  return `${email.charAt(0)}***${email.slice(at)}`;
}

/** Seconds left before another resend is allowed. Zero means resend is available. */
export function cooldownRemainingSeconds(lastSentAtMs: number | null, nowMs: number): number {
  if (lastSentAtMs === null) return 0;
  return Math.max(0, Math.ceil((lastSentAtMs + RESEND_COOLDOWN_SECONDS * 1000 - nowMs) / 1000));
}

export type VerificationFailure =
  | 'code_rejected'
  | 'verify_rate_limited'
  | 'resend_rate_limited'
  | 'email_not_found'
  | 'unknown';

interface AuthErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * Classifies a GoTrue error from verifyOtp or resend. GoTrue answers an invalid, expired and already-used code with
 * the same response (403, otp_expired), so those cases are presented together and the user is offered a new code.
 */
export function classifyVerificationError(error: AuthErrorLike | null | undefined, action: 'verify' | 'resend'): VerificationFailure {
  const code = error?.code ?? '';
  const status = error?.status ?? 0;
  if (code === 'over_request_rate_limit' || (action === 'verify' && status === 429)) return 'verify_rate_limited';
  if (code === 'over_email_send_rate_limit' || (action === 'resend' && status === 429)) return 'resend_rate_limited';
  if (action === 'verify' && (code === 'otp_expired' || status === 403 || code === 'otp_disabled')) return 'code_rejected';
  if (code === 'user_not_found' || code === 'email_address_invalid') return 'email_not_found';
  return 'unknown';
}

export function verificationMessage(failure: VerificationFailure): string {
  switch (failure) {
    case 'code_rejected':
      return 'That code is invalid, has expired, or has already been used. Check the newest email and try again, or request a new code.';
    case 'verify_rate_limited':
      return 'Too many attempts. Wait a few minutes before trying again.';
    case 'resend_rate_limited':
      return 'Please wait before requesting another code.';
    case 'email_not_found':
      return 'We could not find a pending sign-up for that email. Check the address, or request access again.';
    default:
      return 'Something went wrong while checking your code. Please try again.';
  }
}

// ─── Per-browser convenience state (survives a refresh; never authoritative) ──────────────────────────────────────────
// Every read and write is wrapped: storage can be blocked, cleared or unavailable (private windows, previews).

export function getPendingVerificationEmail(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setPendingVerificationEmail(email: string): void {
  try {
    window.sessionStorage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    /* storage unavailable: the page asks for the email again */
  }
}

export function clearPendingVerificationEmail(): void {
  try {
    window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
    window.sessionStorage.removeItem(LAST_RESEND_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function getLastResendAt(): number | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_RESEND_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function setLastResendAt(timestampMs: number): void {
  try {
    window.sessionStorage.setItem(LAST_RESEND_KEY, String(timestampMs));
  } catch {
    /* the in-memory cooldown still applies for this visit */
  }
}
