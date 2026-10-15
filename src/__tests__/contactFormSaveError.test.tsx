/**
 * The contact form must not close unless the save succeeds. When onSave rejects, the dialog stays open and shows
 * the error. A swallowed error must never look like a successful save.
 *
 * The form is opened in edit mode with a valid contact so the same handleSave path runs without filling every field.
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ContactForm } from '../components/feature/ContactForm';
import type { Contact } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const contact = {
  id: 'contact-1',
  cell_id: null,
  contact_name: 'Release Test Contact',
  contact_phone: '0000000000',
  phone_hidden: false,
  email: 'release-test@example.test',
  tag: 'General',
  follow_up_status: 'Open',
  follow_up_assignee: null,
  date_contacted: '2026-01-01',
  notes: 'PR #2 post-migration verification test',
  is_member: false,
} as unknown as Contact;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: { onSave: jest.Mock; onClose: jest.Mock }) {
  act(() => {
    root.render(
      <ContactForm
        isOpen
        onClose={props.onClose}
        onSave={props.onSave}
        contact={contact}
        tags={[]}
        statuses={[]}
        users={[]}
        cellId=""
      />,
    );
  });
}

function saveButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Save Changes'));
  if (!button) throw new Error('Save button not found');
  return button;
}

async function clickSave() {
  await act(async () => {
    saveButton().click();
  });
}

test('a failed save keeps the dialog open and shows the error', async () => {
  const onSave = jest.fn().mockRejectedValue(new Error('invalid input syntax for type uuid: ""'));
  const onClose = jest.fn();
  render({ onSave, onClose });

  await clickSave();

  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  const alert = document.querySelector('[role="alert"]');
  expect(alert).not.toBeNull();
  expect(alert?.textContent).toContain('Could not save contact');
  expect(alert?.textContent).toContain('invalid input syntax for type uuid');
});

test('a successful save closes the dialog and shows no error', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  render({ onSave, onClose });

  await clickSave();

  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
