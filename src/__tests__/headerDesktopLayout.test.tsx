import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { Header } from '../components/layout/Header';

// Desktop: MainLayout renders the header without onMenuToggle. Mobile: it passes onMenuToggle.
// The desktop sidebar already shows the brand, so the desktop header must not repeat it or reserve a spacer.

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no matchMedia; the theme hook reads it. Report a light system theme.
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderHeader(props: Partial<React.ComponentProps<typeof Header>>) {
  act(() => {
    root.render(
      <MemoryRouter>
        <Header userName="Test Coordinator" userRole="coordinator" {...props} />
      </MemoryRouter>,
    );
  });
}

describe('header layout', () => {
  it('desktop (no mobile menu): hides the brand and reserves no spacer column', () => {
    renderHeader({});

    const brand = container.querySelector('img[alt="BLW York"]')!.parentElement!;
    expect(brand.className).toContain('hidden');
    expect(container.querySelector('span[aria-hidden="true"].w-11')).toBeNull();
    expect(container.querySelector('button[aria-label="Open navigation menu"]')).toBeNull();
  });

  it('desktop: keeps the account controls on the right edge', () => {
    renderHeader({ onQuickAdd: () => undefined });

    const right = container.querySelector('header > div.justify-self-end')!;
    expect(right.className).toContain('ml-auto');
    expect(right.textContent).toContain('Test Coordinator');
  });

  it('mobile (menu provided): keeps the hamburger and the brand', () => {
    renderHeader({ onMenuToggle: () => undefined });

    const brand = container.querySelector('img[alt="BLW York"]')!.parentElement!;
    expect(brand.className).not.toContain('hidden');
    expect(container.querySelector('button[aria-label="Open navigation menu"]')).not.toBeNull();
  });
});
