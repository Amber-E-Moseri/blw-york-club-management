import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { VerifyEmail } from '../pages/VerifyEmail';
import { AuthError, resendSignupOtp, verifySignupOtp } from '../lib/auth';
import { setPendingVerificationEmail, clearPendingVerificationEmail } from '../lib/verification/emailOtp';

// Mocks the Auth functions only. No GoTrue runs here, so this proves the page's behaviour, not Supabase's answers.
jest.mock('../lib/auth', () => {
  const actual = jest.requireActual('../lib/auth');
  return {
    ...actual,
    verifySignupOtp: jest.fn(),
    resendSignupOtp: jest.fn(),
  };
});

jest.mock('../lib/supabase', () => ({ supabase: { auth: {}, from: jest.fn(), rpc: jest.fn() }, isConfigured: false }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockedVerify = verifySignupOtp as jest.MockedFunction<typeof verifySignupOtp>;
const mockedResend = resendSignupOtp as jest.MockedFunction<typeof resendSignupOtp>;

const EMAIL = 'marcus.lee@example.org';
let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/verify-email']}>
        <VerifyEmail />
      </MemoryRouter>,
    );
  });
}

const digitInputs = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label^="Digit"]'));
const verifyButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Verify email') as HTMLButtonElement;
const resendButton = () => Array.from(container.querySelectorAll('button')).find((b) => /Send a new code|Resend in/.test(b.textContent ?? '')) as HTMLButtonElement;

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function paste(input: HTMLInputElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  act(() => {
    input.dispatchEvent(event);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  setPendingVerificationEmail(EMAIL);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearPendingVerificationEmail();
});

describe('/verify-email', () => {
  test('shows the masked address, six separate digit boxes, and a disabled verify button', () => {
    render();
    expect(container.textContent).toContain('m***@example.org');
    expect(container.textContent).not.toContain(EMAIL);
    expect(digitInputs()).toHaveLength(6);
    expect(digitInputs()[0].getAttribute('autocomplete')).toBe('one-time-code');
    expect(verifyButton().disabled).toBe(true);
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  test('asks for the email when none is remembered, and never verifies without one', () => {
    clearPendingVerificationEmail();
    render();
    expect(digitInputs()).toHaveLength(0);
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });

  test('a pasted code submits once, with the email and the signup type, and then shows the verified state', async () => {
    mockedVerify.mockResolvedValue(undefined);
    render();
    paste(digitInputs()[0], '123 456');
    await flush();
    expect(mockedVerify).toHaveBeenCalledTimes(1);
    expect(mockedVerify).toHaveBeenCalledWith(EMAIL, '123456');
    // Success hands over to App's auth gate (pending-approval screen); the code form is replaced, not left behind.
    expect(container.textContent).toContain('Email verified');
    expect(digitInputs()).toHaveLength(0);
  });

  test('a pasted code fills all six boxes before submitting when verification is still pending', async () => {
    mockedVerify.mockImplementation(() => new Promise<void>(() => undefined));
    render();
    paste(digitInputs()[0], '123 456');
    await flush();
    expect(digitInputs().map((i) => i.value).join('')).toBe('123456');
  });

  test('typing the sixth digit submits, and typing moves focus forward', async () => {
    mockedVerify.mockResolvedValue(undefined);
    render();
    const inputs = digitInputs();
    typeInto(inputs[0], '4');
    expect(document.activeElement).toBe(inputs[1]);
    ['5', '6', '7', '8', '9'].forEach((digit, index) => typeInto(inputs[index + 1], digit));
    await flush();
    expect(mockedVerify).toHaveBeenCalledWith(EMAIL, '456789');
  });

  test('a second submit while a request is in progress is refused', async () => {
    let resolveFirst: () => void = () => undefined;
    mockedVerify.mockImplementation(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    render();
    paste(digitInputs()[0], '111222');
    await flush();
    // The first submit is in flight. Pasting the same code again must not start a second verification.
    paste(digitInputs()[0], '111222');
    paste(digitInputs()[0], '111222');
    await flush();
    expect(mockedVerify).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst());
  });

  test('an expired, invalid or used code shows the generic code message and clears the boxes', async () => {
    mockedVerify.mockRejectedValue(new AuthError('Token has expired or is invalid', 'otp_expired', 403));
    render();
    paste(digitInputs()[0], '000000');
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/invalid, has expired, or has already been used/i);
    expect(digitInputs().every((i) => i.value === '')).toBe(true);
    expect(container.textContent).not.toContain('000000');
  });

  test('a verify rate limit shows its own message', async () => {
    mockedVerify.mockRejectedValue(new AuthError('Too many', 'over_request_rate_limit', 429));
    render();
    paste(digitInputs()[0], '999999');
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Too many attempts/);
  });

  test('a resend starts a visible cooldown that disables the control, and asks Supabase for a new code', async () => {
    mockedResend.mockResolvedValue(undefined);
    render();
    await act(async () => {
      resendButton().click();
    });
    expect(mockedResend).toHaveBeenCalledWith(EMAIL);
    expect(resendButton().textContent).toMatch(/Resend in \d+s/);
    expect(resendButton().disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/new code is on its way/i);
  });

  test('a resend refused by Supabase shows the send rate-limit message and keeps the cooldown', async () => {
    mockedResend.mockRejectedValue(new AuthError('rate', 'over_email_send_rate_limit', 429));
    render();
    await act(async () => {
      resendButton().click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Please wait before requesting another code/);
    expect(resendButton().disabled).toBe(true);
  });

  test('a cooldown already running when the page loads is respected after a refresh', () => {
    window.sessionStorage.setItem('blwyork.lastVerificationResend', String(Date.now()));
    render();
    expect(resendButton().disabled).toBe(true);
  });

  test('the page never writes the code, a password or a token to the console', async () => {
    const logSpies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m as 'log'));
    mockedVerify.mockRejectedValue(new AuthError('Token has expired or is invalid', 'otp_expired', 403));
    render();
    paste(digitInputs()[0], '424242');
    await flush();
    const logged = logSpies.flatMap((s) => s.mock.calls).map((args) => args.join(' ')).join('\n');
    expect(logged).not.toContain('424242');
    logSpies.forEach((s) => s.mockRestore());
  });
});
