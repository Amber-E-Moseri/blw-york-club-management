import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

// matchMedia is not implemented in jsdom; stub it to report light mode by default.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('ThemeToggle', () => {
  it('renders with an accessible label in the header', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    // Default theme is 'system' (no stored preference) — label describes next action.
    const btn = screen.getByRole('button', { name: 'Switch to light mode' });
    expect(btn).toBeInTheDocument();
  });

  it('cycles theme on click and updates aria-label', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    // Start: system → next is light
    const btn = screen.getByRole('button', { name: 'Switch to light mode' });
    await user.click(btn);
    // Now: light → next is dark
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    // Now: dark → next is system
    expect(screen.getByRole('button', { name: 'Switch to system preference' })).toBeInTheDocument();
  });

  it('applies html.dark class when dark theme is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    // system → light
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    // light → dark
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('persists the preference to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    // system → light
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(localStorage.getItem('blwyork-theme')).toBe('light');
    // light → dark
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(localStorage.getItem('blwyork-theme')).toBe('dark');
  });

  it('is visible at all header widths (no hidden class)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: 'Switch to light mode' });
    // The toggle must not carry a responsive hidden class.
    expect(btn.className).not.toMatch(/\bhidden\b/);
    expect(btn.className).not.toMatch(/\blg:hidden\b/);
  });
});
