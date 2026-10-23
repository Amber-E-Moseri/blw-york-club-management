import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { Announcements, describePostError } from '../pages/Announcements';
import { createAnnouncement, getAnnouncements, notifyAnnouncementMembers } from '../lib/queries';
import type { AuthUser } from '../lib/auth';

// Mocks the query layer only. The page's own submit path is what is under test.
jest.mock('../lib/queries', () => ({
  getAnnouncements: jest.fn(),
  createAnnouncement: jest.fn(),
  notifyAnnouncementMembers: jest.fn(),
}));

const mockedGet = getAnnouncements as jest.Mock;
const mockedCreate = createAnnouncement as jest.Mock;
const mockedNotify = notifyAnnouncementMembers as jest.Mock;

const coordinator = {
  id: 'coord-1',
  email: 'coordinator@example.test',
  name: 'Test Coordinator',
  role: 'coordinator',
  status: 'active',
  createdAt: new Date('2026-01-01'),
} as AuthUser;

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue([]);
  mockedNotify.mockResolvedValue({ recipients: 0, devices: 0, sent: 0, failed: 0, expired: 0 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage(user: AuthUser = coordinator) {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Announcements user={user} />
      </MemoryRouter>,
    );
  });
  await flush();
}

function buttonWith(text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!match) throw new Error(`No button containing "${text}"`);
  return match as HTMLButtonElement;
}

async function openForm() {
  await act(async () => {
    buttonWith('+ New').click();
  });
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function titleInput(): HTMLInputElement {
  return container.querySelector('input:not([type=checkbox])') as HTMLInputElement;
}

function messageInput(): HTMLTextAreaElement {
  return container.querySelector('textarea') as HTMLTextAreaElement;
}

async function fill(title: string, message: string) {
  await act(async () => {
    setValue(titleInput(), title);
    setValue(messageInput(), message);
  });
}

async function clickPost() {
  await act(async () => {
    buttonWith('Post Announcement').click();
  });
  await flush();
}

function alertText(): string {
  return container.querySelector('[role=alert]')?.textContent ?? '';
}

function statusText(): string {
  return container.querySelector('[role=status]')?.textContent ?? '';
}

describe('posting an announcement: empty fields', () => {
  it('shows a message next to each empty field and does not call the database', async () => {
    await renderPage();
    await openForm();

    await clickPost();

    expect(container.textContent).toContain('Enter a title for the announcement.');
    expect(container.textContent).toContain('Enter the message to post.');
    expect(mockedCreate).not.toHaveBeenCalled();
    // The form stays open so the author can fix the fields.
    expect(titleInput()).toBeTruthy();
  });

  it('clears the field message once the author types in that field', async () => {
    await renderPage();
    await openForm();
    await clickPost();

    await act(async () => {
      setValue(titleInput(), 'A title');
    });

    expect(container.textContent).not.toContain('Enter a title for the announcement.');
    expect(container.textContent).toContain('Enter the message to post.');
  });
});

describe('posting an announcement: database failures', () => {
  it('shows an actionable message when the insert is refused, and keeps the author text', async () => {
    mockedCreate.mockRejectedValue(new Error('new row violates row-level security policy for table "announcements"'));
    await renderPage();
    await openForm();
    await fill('Service update', 'Doors open at 6pm.');

    await clickPost();

    expect(alertText()).toContain('not allowed to post announcements');
    expect(alertText()).toContain('nothing was saved');
    expect(statusText()).toBe('');
    expect(titleInput().value).toBe('Service update');
    expect(messageInput().value).toBe('Doors open at 6pm.');
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('does not show "posted" when the insert fails', async () => {
    mockedCreate.mockRejectedValue(new Error('network down'));
    await renderPage();
    await openForm();
    await fill('Title', 'Body');

    await clickPost();

    expect(statusText()).toBe('');
    expect(container.textContent).not.toContain('Announcement posted.');
  });
});

describe('posting an announcement: success is confirmed by the database', () => {
  it('keeps the button busy while the insert is pending, and shows success only after it resolves', async () => {
    let resolveInsert: (id: string) => void = () => undefined;
    mockedCreate.mockReturnValue(new Promise<string>((resolve) => { resolveInsert = resolve; }));
    await renderPage();
    await openForm();
    await fill('Title', 'Body');
    // Push notifications off, so the only thing being awaited is the insert.
    await act(async () => {
      (container.querySelector('input[type=checkbox]') as HTMLInputElement).click();
    });

    await clickPost();

    const busyButton = container.querySelector('button[aria-busy="true"]') as HTMLButtonElement | null;
    expect(busyButton).not.toBeNull();
    expect(busyButton!.disabled).toBe(true);
    expect(statusText()).toBe('');

    await act(async () => {
      resolveInsert('announcement-1');
    });
    await flush();

    expect(statusText()).toBe('Announcement posted.');
    expect(mockedCreate).toHaveBeenCalledWith('Title', 'Body', 'coord-1', 'Test Coordinator');
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it('reports a list refresh failure after a saved post as a notice, not as a failed post', async () => {
    mockedCreate.mockResolvedValue('announcement-2');
    mockedNotify.mockResolvedValue({ recipients: 1, devices: 1, sent: 1, failed: 0, expired: 0 });
    await renderPage();
    await openForm();
    await fill('Title', 'Body');
    mockedGet.mockRejectedValueOnce(new Error('refresh failed'));

    await clickPost();

    expect(alertText()).toBe('');
    expect(statusText()).toContain('Posted.');
    expect(statusText()).toContain('did not refresh');
  });
});

describe('describePostError', () => {
  it('explains a refused write in plain terms', () => {
    expect(describePostError(new Error('new row violates row-level security policy'))).toContain('not allowed');
  });

  it('explains an expired session', () => {
    expect(describePostError(new Error('JWT expired'))).toContain('session has expired');
  });

  it('explains a network failure', () => {
    expect(describePostError(new TypeError('Failed to fetch'))).toContain('Could not reach the server');
  });

  it('falls back to the database message for anything else, and always says nothing was saved', () => {
    expect(describePostError(new Error('something odd'))).toBe(
      'Could not post the announcement, so nothing was saved: something odd',
    );
    expect(describePostError('not an error')).toContain('nothing was saved');
  });
});
