import {
  OTP_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  classifyVerificationError,
  clearPendingVerificationEmail,
  cooldownRemainingSeconds,
  getLastResendAt,
  getPendingVerificationEmail,
  isCompleteOtp,
  maskEmail,
  sanitizeOtp,
  setLastResendAt,
  setPendingVerificationEmail,
  verificationMessage,
} from '../lib/verification/emailOtp';

describe('six-digit code input', () => {
  test('uses a six-digit code', () => {
    expect(OTP_LENGTH).toBe(6);
  });

  test('sanitizeOtp keeps digits only, in order, and caps the length', () => {
    expect(sanitizeOtp('12 34-56')).toBe('123456');
    expect(sanitizeOtp('1234567890')).toBe('123456');
    expect(sanitizeOtp('abc')).toBe('');
    expect(sanitizeOtp('')).toBe('');
  });

  test('isCompleteOtp accepts exactly six digits', () => {
    expect(isCompleteOtp('123456')).toBe(true);
    expect(isCompleteOtp('12345')).toBe(false);
    expect(isCompleteOtp('1234567')).toBe(false);
    expect(isCompleteOtp('12345a')).toBe(false);
    expect(isCompleteOtp('')).toBe(false);
  });
});

describe('maskEmail', () => {
  test('keeps the first character and the domain only', () => {
    expect(maskEmail('marcus.lee@example.org')).toBe('m***@example.org');
  });

  test('never returns a full local part, even when it is one character', () => {
    expect(maskEmail('a@example.org')).toBe('a***@example.org');
  });

  test('returns a fixed placeholder for something that is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('@example.org')).toBe('***');
    expect(maskEmail('user@')).toBe('***');
  });
});

describe('resend cooldown', () => {
  test('is zero when nothing has been sent in this browser', () => {
    expect(cooldownRemainingSeconds(null, 1_000)).toBe(0);
  });

  test('counts down from the cooldown length and reaches zero', () => {
    const sent = 10_000;
    expect(cooldownRemainingSeconds(sent, sent)).toBe(RESEND_COOLDOWN_SECONDS);
    expect(cooldownRemainingSeconds(sent, sent + 1_000)).toBe(RESEND_COOLDOWN_SECONDS - 1);
    expect(cooldownRemainingSeconds(sent, sent + RESEND_COOLDOWN_SECONDS * 1000)).toBe(0);
    expect(cooldownRemainingSeconds(sent, sent + 999_999)).toBe(0);
  });
});

describe('error classification', () => {
  test('an expired, invalid or already-used code is one case (GoTrue answers all three the same way)', () => {
    expect(classifyVerificationError({ status: 403, code: 'otp_expired' }, 'verify')).toBe('code_rejected');
    expect(classifyVerificationError({ status: 403, code: undefined }, 'verify')).toBe('code_rejected');
  });

  test('verify and resend rate limits are separate messages', () => {
    expect(classifyVerificationError({ status: 429, code: 'over_request_rate_limit' }, 'verify')).toBe('verify_rate_limited');
    expect(classifyVerificationError({ status: 429, code: 'over_email_send_rate_limit' }, 'resend')).toBe('resend_rate_limited');
    expect(classifyVerificationError({ status: 429 }, 'resend')).toBe('resend_rate_limited');
  });

  test('an unknown email is reported without confirming whether an account exists', () => {
    expect(classifyVerificationError({ code: 'user_not_found' }, 'resend')).toBe('email_not_found');
  });

  test('anything else is unknown and gets a generic, non-leaking message', () => {
    expect(classifyVerificationError({ status: 500, code: 'unexpected_failure' }, 'verify')).toBe('unknown');
    expect(classifyVerificationError(null, 'verify')).toBe('unknown');
    expect(verificationMessage('unknown')).not.toMatch(/token|password|secret/i);
  });

  test('the code-rejected message offers a new code', () => {
    expect(verificationMessage('code_rejected')).toMatch(/request a new code/i);
  });
});

describe('per-browser convenience state', () => {
  beforeEach(() => window.sessionStorage.clear());

  test('remembers the pending email across a refresh and clears it', () => {
    setPendingVerificationEmail('member@example.org');
    expect(getPendingVerificationEmail()).toBe('member@example.org');
    clearPendingVerificationEmail();
    expect(getPendingVerificationEmail()).toBeNull();
  });

  test('remembers the last resend time so a refresh does not reset the cooldown', () => {
    setLastResendAt(5_000);
    expect(getLastResendAt()).toBe(5_000);
    clearPendingVerificationEmail();
    expect(getLastResendAt()).toBeNull();
  });

  test('a blocked or throwing storage degrades to no stored state instead of an error', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getPendingVerificationEmail()).toBeNull();
    expect(getLastResendAt()).toBeNull();
    spy.mockRestore();
  });
});
