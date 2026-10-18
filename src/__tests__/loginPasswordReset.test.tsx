import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../pages/Login';
import { AuthError, resetPassword } from '../lib/auth';

// Mocks the reset request only. The page's behaviour is what is under test, not Supabase's answers.
jest.mock('../lib/supabase', () => ({
  supabase: { auth: {}, from: jest.fn(), rpc: jest.fn() },
  isConfigured: true,
  recoveryLink: { kind: 'none' },
}));

jest.mock('../lib/auth', () => {
  const actual = jest.requireActual('../lib/auth');
  return { ...actual, resetPassword: jest.fn() };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockReset = resetPassword as jest.MockedFunction<typeof resetPassword>;

const GENERIC_SENT = 'If an account exists for that email, we have sent a password reset link';

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderLogin() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Login onSignIn={jest.fn()} onSignUp={jest.fn()} error={null} loading={false} />
      </MemoryRouter>,
    );
  });
  await flush();
}

function setInput(selector: string, value: string) {
  const el = container.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`no input ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function openForgotPassword() {
  const link = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Forgot password?');
  if (!link) throw new Error('no Forgot password link');
  act(() => {
    link.click();
  });
}

function submitForm() {
  const form = container.querySelector('form');
  if (!form) throw new Error('no form');
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function noticeText(): string {
  return container.querySelector('[role="status"], [role="alert"]')?.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Login: forgot password', () => {
  test('a Forgot password link opens the email form, carrying over any typed address', async () => {
    await renderLogin();
    setInput('input[type="email"]', 'member@example.org');
    openForgotPassword();
    expect(container.textContent).toContain('Reset your password');
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe('member@example.org');
  });

  test('a valid address sends one reset request and shows the generic confirmation', async () => {
    mockReset.mockResolvedValue(undefined);
    await renderLogin();
    openForgotPassword();
    setInput('input[type="email"]', '  member@example.org ');
    submitForm();
    await flush();
    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockReset).toHaveBeenCalledWith('member@example.org');
    expect(noticeText()).toContain(GENERIC_SENT);
  });

  test('a known and an unknown address get the same confirmation text', async () => {
    mockReset.mockResolvedValue(undefined);
    await renderLogin();
    openForgotPassword();
    setInput('input[type="email"]', 'known@example.org');
    submitForm();
    await flush();
    const forKnown = noticeText();

    mockReset.mockResolvedValue(undefined);
    setInput('input[type="email"]', 'unknown@example.org');
    submitForm();
    await flush();
    const forUnknown = noticeText();

    expect(forKnown).toBe(forUnknown);
    expect(forKnown).toContain(GENERIC_SENT);
    expect(forKnown).not.toMatch(/not found|no account|does not exist|unknown/i);
  });

  test('an email rate limit gets its own safe message, not the confirmation', async () => {
    mockReset.mockRejectedValue(new AuthError('Too many attempts. Please wait a moment and try again.', 'email rate limit exceeded'));
    await renderLogin();
    openForgotPassword();
    setInput('input[type="email"]', 'member@example.org');
    submitForm();
    await flush();
    expect(noticeText()).toContain('Too many reset requests');
    expect(noticeText()).not.toContain(GENERIC_SENT);
  });

  test('a rate limit worded as a security cooldown is also treated as a rate limit', async () => {
    mockReset.mockRejectedValue(new AuthError('wait', 'For security purposes, you can only request this after 60 seconds.'));
    await renderLogin();
    openForgotPassword();
    setInput('input[type="email"]', 'member@example.org');
    submitForm();
    await flush();
    expect(noticeText()).toContain('Too many reset requests');
  });

  test('any other failure shows a generic retry message', async () => {
    mockReset.mockRejectedValue(new AuthError('Internal error', 'unexpected_failure'));
    await renderLogin();
    openForgotPassword();
    setInput('input[type="email"]', 'member@example.org');
    submitForm();
    await flush();
    expect(noticeText()).toContain('We could not send the reset email right now');
  });

  test('a malformed address is refused before any request is sent', async () => {
    await renderLogin();
    openForgotPassword();
    setInput('input[type="email"]', 'not-an-email');
    submitForm();
    await flush();
    expect(mockReset).not.toHaveBeenCalled();
    expect(noticeText()).toBe('Enter a valid email address.');
  });

  test('a second submit while a request is in flight does not send another', async () => {
    let finish: () => void = () => undefined;
    mockReset.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await renderLogin();
    openForgotPassword();
    setInput('input[type="email"]', 'member@example.org');
    submitForm();
    submitForm();
    await flush();
    expect(mockReset).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    await flush();
  });

  test('Back to Sign In returns to the sign-in form', async () => {
    await renderLogin();
    openForgotPassword();
    const back = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Back to Sign In');
    act(() => {
      back?.click();
    });
    await flush();
    expect(container.textContent).toContain('Sign In');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });
});
