// Devotional upload, review step: a Pages field must accept what the admin types. A half-typed range such as "10-" is
// shown as typed, and only a valid range changes the saved day. Blurring a half-typed value restores the saved range.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AdminDevotionalUpload } from '../pages/AdminDevotionalUpload';

jest.mock('../lib/supabase', () => require('../testUtils/supabaseRecorder'));

const user = { id: 'u1', email: 'leader@yorku.ca', name: 'Test Leader', role: 'admin', status: 'active' } as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Sets a controlled input's value the way a keyboard does, so React sees the change. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The Pages input of the given day, found through the card that carries the "Day N" heading. */
function pagesInput(day: number): HTMLInputElement {
  const card = Array.from(container.querySelectorAll('div.rounded-md')).find(
    (el) => el.querySelector('p')?.textContent === `Day ${day}`,
  );
  const input = card?.querySelector('input');
  if (!input) throw new Error(`no Pages input for day ${day}`);
  return input as HTMLInputElement;
}

function openReview() {
  act(() => {
    root.render(
      <MemoryRouter>
        <AdminDevotionalUpload user={user} />
      </MemoryRouter>,
    );
  });
  const detect = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Detect Page Structure'));
  if (!detect) throw new Error('Detect Page Structure button not found');
  act(() => detect.click());
}

function blur(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    input.blur();
  });
}

describe('devotional review: Pages field', () => {
  test('a half-typed range stays on screen as typed', () => {
    openReview();
    const input = pagesInput(4);
    typeInto(input, '10-');
    expect(pagesInput(4).value).toBe('10-');
  });

  test('a complete range is applied as it is typed', () => {
    openReview();
    typeInto(pagesInput(4), '10-12');
    expect(pagesInput(4).value).toBe('10-12');
    typeInto(pagesInput(4), '10-12');
    expect(pagesInput(4).value).toBe('10-12');
  });

  test('blurring an invalid range restores the saved range', () => {
    openReview();
    const before = pagesInput(4).value;
    typeInto(pagesInput(4), '9-3');
    blur(pagesInput(4));
    expect(pagesInput(4).value).toBe(before);
  });
});
