import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Globals are off, so Testing Library cannot register its own cleanup. Without this, DOM from earlier tests leaks
// into later queries.
afterEach(() => {
  cleanup();
});

// jsdom does not implement layout scrolling. Routes call scrollTo on navigation, so stub it.
Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });
