import React, { useState } from 'react';
import { act } from 'react-dom/test-utils';
import ReactDOM from 'react-dom/client';
import { Modal } from '../components/foundation/Modal';
import { Input } from '../components/foundation/Input';

// Mirrors the Book of the Month form: the parent passes an inline onClose and
// re-renders on every keystroke. Focus must stay in the field being typed in.
const Harness: React.FC = () => {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState('');
  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Add Book">
      <Input label="Title" value={value} onChange={setValue} />
    </Modal>
  );
};

// A trigger button opens the modal, and an outside button closes it programmatically.
const WithTrigger: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="trigger" type="button" onClick={() => setOpen(true)}>Add Book</button>
      <button id="force-close" type="button" onClick={() => setOpen(false)}>Force close</button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Add Book">
        <Input label="Title" value="" onChange={() => {}} />
        <button id="done" type="button">Done</button>
      </Modal>
    </>
  );
};

let container: HTMLDivElement;
let root: ReactDOM.Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const typeValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

test('typing in a modal field keeps focus in the field, not the close button', () => {
  act(() => { root.render(<Harness />); });

  const input = document.querySelector<HTMLInputElement>('input')!;

  act(() => {
    input.focus();
    typeValue(input, 'a');
  });
  act(() => typeValue(input, 'ab'));

  expect(input.value).toBe('ab');
  expect(document.activeElement).toBe(input);
  expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Close dialog');
});

test('focus moves into the dialog when it opens', () => {
  act(() => { root.render(<Harness />); });

  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.contains(document.activeElement)).toBe(true);
});

test('Escape and the close button call the latest onClose', () => {
  const first = jest.fn();
  const second = jest.fn();
  const render = (onClose: () => void) => (
    <Modal isOpen onClose={onClose} title="Add Book">
      <Input label="Title" value="" onChange={() => {}} />
    </Modal>
  );

  act(() => { root.render(render(first)); });
  act(() => { root.render(render(second)); });

  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);

  act(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!.click();
  });
  expect(second).toHaveBeenCalledTimes(2);
  expect(first).not.toHaveBeenCalled();
});

test('Tab wraps focus from the last focusable element back to the first', () => {
  act(() => { root.render(<Harness />); });

  const focusable = document.querySelectorAll<HTMLElement>(
    '[role="dialog"] button, [role="dialog"] input, [role="dialog"] textarea'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  act(() => last.focus());
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  });

  expect(document.activeElement).toBe(first);
});

const openFromTrigger = () => {
  const trigger = document.getElementById('trigger') as HTMLButtonElement;
  act(() => trigger.focus());
  act(() => trigger.click());
  return trigger;
};

const isDialogOpen = () => document.querySelector('[role="dialog"]') !== null;

test('Escape closes the dialog and returns focus to the trigger', () => {
  act(() => { root.render(<WithTrigger />); });
  const trigger = openFromTrigger();
  expect(isDialogOpen()).toBe(true);

  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  expect(isDialogOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test('the close button closes the dialog and returns focus to the trigger', () => {
  act(() => { root.render(<WithTrigger />); });
  const trigger = openFromTrigger();

  act(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!.click();
  });

  expect(isDialogOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test('a programmatic close returns focus to the trigger', () => {
  act(() => { root.render(<WithTrigger />); });
  const trigger = openFromTrigger();

  act(() => {
    document.getElementById('force-close')!.click();
  });

  expect(isDialogOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test('Shift+Tab from the first focusable element wraps to the last', () => {
  act(() => { root.render(<WithTrigger />); });
  openFromTrigger();

  const closeButton = document.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')!;
  expect(document.activeElement).toBe(closeButton);

  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  });

  expect(document.activeElement).toBe(document.getElementById('done'));
});

test('Tab pulls focus back into the dialog when it has escaped', () => {
  act(() => { root.render(<WithTrigger />); });
  openFromTrigger();

  // Focus something outside the dialog while it is open.
  act(() => document.getElementById('force-close')!.focus());
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  });

  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.contains(document.activeElement)).toBe(true);
});
