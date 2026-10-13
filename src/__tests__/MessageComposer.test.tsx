import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MessageComposer } from '../components/feature/MessageComposer';
import type { AuthUser } from '../lib/auth';

// The composer talks to the database only through this service module. Mock it so the tests check UI behaviour.
jest.mock('../lib/queries/communications', () => ({
  listCellsForComposer: jest.fn().mockResolvedValue([
    { id: 'cell-a', name: 'Cell A' },
    { id: 'cell-b', name: 'Cell B' },
  ]),
  listSavedGroupsForComposer: jest.fn().mockResolvedValue([]),
  listActiveMembersForComposer: jest.fn().mockResolvedValue([]),
  previewAudience: jest.fn().mockResolvedValue({ count: 2, recipients: [{ id: 'p1', name: 'Ada', cellId: 'cell-a' }] }),
  sendMessage: jest.fn(),
}));

const services = jest.requireMock('../lib/queries/communications') as {
  listCellsForComposer: jest.Mock;
  listSavedGroupsForComposer: jest.Mock;
  listActiveMembersForComposer: jest.Mock;
  previewAudience: jest.Mock;
  sendMessage: jest.Mock;
};

const leader: AuthUser = {
  id: 'leader',
  email: 'leader@example.org',
  name: 'Leader',
  role: 'cell_leader',
  status: 'active',
  cellId: 'cell-a',
  createdAt: new Date('2026-01-01'),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // CRA resets mock implementations before each test, so the service stubs are armed here, not in the factory.
  services.listCellsForComposer.mockResolvedValue([
    { id: 'cell-a', name: 'Cell A' },
    { id: 'cell-b', name: 'Cell B' },
  ]);
  services.listSavedGroupsForComposer.mockResolvedValue([]);
  services.listActiveMembersForComposer.mockResolvedValue([]);
  services.previewAudience.mockResolvedValue({ count: 2, recipients: [{ id: 'p1', name: 'Ada', cellId: 'cell-a' }] });
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
    await Promise.resolve();
  });
}

describe('MessageComposer', () => {
  test('a cell leader is offered only the cells audience', async () => {
    await act(async () => {
      root.render(<MessageComposer user={leader} onSent={() => undefined} />);
    });
    await flush();
    const modes = Array.from(container.querySelectorAll('[role="radio"]')).map((el) => el.textContent);
    expect(modes).toEqual(['Cells']);
    expect(container.textContent).not.toMatch(/Everyone/);
  });

  test('a cell leader sees only their own cell in the picker', async () => {
    await act(async () => {
      root.render(<MessageComposer user={leader} onSent={() => undefined} />);
    });
    await flush();
    const labels = Array.from(container.querySelectorAll('fieldset label')).map((el) => el.textContent);
    expect(labels).toEqual(['Cell A']);
  });

  test('Send is disabled until recipients have been previewed', async () => {
    await act(async () => {
      root.render(<MessageComposer user={leader} onSent={() => undefined} />);
    });
    await flush();
    const send = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send message') as HTMLButtonElement;
    expect(send).toBeDefined();
    expect(send.disabled).toBe(true);
  });

  test('previewing a cell calls the preview service with that cell only', async () => {
    await act(async () => {
      root.render(<MessageComposer user={leader} onSent={() => undefined} />);
    });
    await flush();
    const cellBox = container.querySelector('fieldset input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      cellBox.click();
    });
    const preview = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Preview recipients') as HTMLButtonElement;
    await act(async () => {
      preview.click();
    });
    await flush();
    expect(services.previewAudience).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'cells', cellIds: ['cell-a'] }),
    );
    expect(container.textContent).toMatch(/Will reach 2 active members/);
  });

  test('a member without a composer role sees no compose controls', async () => {
    const member: AuthUser = { ...leader, role: 'member', cellId: undefined };
    await act(async () => {
      root.render(<MessageComposer user={member} onSent={() => undefined} />);
    });
    await flush();
    expect(container.textContent).toMatch(/Only leaders and staff can send messages/);
    expect(container.querySelector('button')).toBeNull();
  });
});
