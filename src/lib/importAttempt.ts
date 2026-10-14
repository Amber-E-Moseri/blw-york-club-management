// One logical import has one attempt id. The id is created when the user starts an import and is kept until every row of
// it is confirmed in the database. Corrected re-uploads, retries after an invalid row, and retries after an uncertain
// response all reuse the id. Each row's idempotency key is '<attemptId>:<original row number>', so a row keeps its key
// however the rest of the file changes. A row confirmed once is never sent again.
//
// A second, intentional import of the same list is a NEW import: it starts only after the previous one completed, or after
// the user explicitly discards the open one. It gets a new id and therefore writes its rows again. Nothing here looks at
// names, emails, phones or filenames to decide that two rows are the same contact.

import type { ImportAttempt } from '../types';

/** A new attempt with no confirmed rows. `newId` is supplied by the caller (crypto.randomUUID in the app, a fixed id in tests). */
export function startImportAttempt(newId: () => string): ImportAttempt {
  return { attemptId: newId(), confirmed: {} };
}

/**
 * A deterministic fingerprint of a row's content, used only to detect that an already-written row was edited. It is not an
 * identity and never decides that two rows are the same contact. Two 32-bit FNV-style hashes (no BigInt: the build targets es5).
 */
export function fingerprintText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

const storageKey = (userId: string) => `blwyork.importAttempt.${userId}`;

function sessionStore(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** The open attempt for this user in this tab, if any. Survives a page reload; null when storage is unavailable. */
export function loadOpenAttempt(userId: string): ImportAttempt | null {
  try {
    const raw = sessionStore()?.getItem(storageKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ImportAttempt>;
    if (typeof value.attemptId !== 'string' || !value.confirmed || typeof value.confirmed !== 'object') return null;
    return { attemptId: value.attemptId, confirmed: value.confirmed as Record<string, string> };
  } catch {
    return null;
  }
}

/** Stores the open attempt, or removes it when `attempt` is null (the import completed or the user started a new one). */
export function saveOpenAttempt(userId: string, attempt: ImportAttempt | null): void {
  try {
    const store = sessionStore();
    if (!store) return;
    if (attempt) store.setItem(storageKey(userId), JSON.stringify(attempt));
    else store.removeItem(storageKey(userId));
  } catch {
    // Storage is unavailable or full. The attempt then lives only in this page's memory: a reload would start a new one.
  }
}

/** The open attempt to continue, or a new one when there is none. */
export function openOrStartAttempt(userId: string, newId: () => string): ImportAttempt {
  return loadOpenAttempt(userId) ?? startImportAttempt(newId);
}

/** How many rows of the open import are already written. 0 when there is no open import. */
export function openAttemptRowCount(userId: string): number {
  const attempt = loadOpenAttempt(userId);
  return attempt ? Object.keys(attempt.confirmed).length : 0;
}
