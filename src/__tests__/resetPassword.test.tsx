import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { ResetPassword } from '../pages/ResetPassword';
import { changePassword, establishRecoverySession, signOut, AuthError, type RecoveryStatus } from '../lib/auth';

// Mocks the Auth functions only. The page's behaviour is what is under test, not GoTrue's answers.
jest.mock('../lib/supabase', () => ({
  supabase: { auth: {}, from: jest.fn(), rpc: jest.fn() },
  isConfigured: false,
  recoveryLink: { kind: 'pkce', code: 'test-code' },
}));

jest.mock('../lib/auth', () => {
  const actual = jest.requireActual('../lib/auth');
  return {
    ...actual,
    establishRecoverySession: jest.fn(),
    changePassword: jest.fn(),
    signOut: jest.fn(),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEstablish = establishRecoverySession as jest.MockedFunction<typeof establishRecoverySession>;
const mockChange = changePassword as jest.MockedFunction<typeof changePassword>;
const mockSignOut = signOut as jest.MockedFunction<typeof signOut>;

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(status: RecoveryStatus) {
  mockEstablish.mockResolvedValue(status);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <ResetPassword />
      </MemoryRouter>,
    );
  });
  await flush();
}

function setInput(name: string, value: string) {
  const el = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!el) throw new Error(`no input named ${name}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submitForm() {
  const form = container.querySelector('form');
  if (!form) throw new Error('no form');
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function buttonWith(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
}

function clickButton(text: string) {
  const button = buttonWith(text);
  if (!button) throw new Error(`no button ${text}`);
  act(() => {
    button.click();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ResetPassword: links that cannot be used', () => {
  test('a missing recovery session shows no form and no way to submit', async () => {
    await render('missing');
    expect(container.textContent).toContain('Open the password reset link from your email');
    expect(container.querySelector('input[name="new-password"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(buttonWith('Update password')).toBeUndefined();
  });

  test('an expired link says so, offers a safe way back, and shows no form', async () => {
    await render('expired');
    expect(container.textContent).toContain('has expired');
    expect(container.querySelector('input[name="new-password"]')).toBeNull();
    expect(buttonWith('Back to sign in')).toBeDefined();
  });

  test('an invalid link is reported as invalid, not as expired', async () => {
    await render('invalid');
    expect(container.textContent).toContain('is not valid');
    expect(container.textContent).not.toContain('has expired');
    expect(container.querySelector('input[name="new-password"]')).toBeNull();
  });

  test('back to sign in ends any session and returns to the sign-in page', async () => {
    await render('expired');
    clickButton('Back to sign in');
    await flush();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('ResetPassword: a valid recovery session', () => {
  test('a valid link shows the form', async () => {
    await render('ready');
    expect(container.querySelector('input[name="new-password"]')).not.toBeNull();
    expect(container.querySelector('input[name="confirm-password"]')).not.toBeNull();
    expect(buttonWith('Update password')).toBeDefined();
  });

  test('successful recovery updates the password, ends the session and confirms', async () => {
    mockChange.mockResolvedValue(undefined);
    await render('ready');
    setInput('new-password', 'correct-horse');
    setInput('confirm-password', 'correct-horse');
    submitForm();
    await flush();
    expect(mockChange).toHaveBeenCalledWith('correct-horse');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Your password has been updated');
    expect(container.querySelector('input[name="new-password"]')).toBeNull();
  });

  test('mismatched passwords are refused without calling the update', async () => {
    await render('ready');
    setInput('new-password', 'abcdef-1');
    setInput('confirm-password', 'abcdef-2');
    submitForm();
    await flush();
    expect(container.textContent).toContain('do not match');
    expect(mockChange).not.toHaveBeenCalled();
  });

  test('a password shorter than the minimum is refused without calling the update', async () => {
    await render('ready');
    setInput('new-password', 'abc');
    setInput('confirm-password', 'abc');
    submitForm();
    await flush();
    expect(container.textContent).toContain('at least 6 characters');
    expect(mockChange).not.toHaveBeenCalled();
  });

  test('a failed update shows the reason and keeps the form, without ending the session', async () => {
    mockChange.mockRejectedValue(new AuthError('New password should be different from the old password.'));
    await render('ready');
    setInput('new-password', 'same-as-before');
    setInput('confirm-password', 'same-as-before');
    submitForm();
    await flush();
    expect(container.textContent).toContain('should be different from the old password');
    expect(container.querySelector('input[name="new-password"]')).not.toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test('the code is removed from the address bar once the page has read it', async () => {
    window.history.replaceState(null, '', '/reset-password?code=test-code');
    await render('ready');
    expect(window.location.search).toBe('');
  });
});
