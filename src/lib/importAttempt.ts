// One logical import is one attempt, and it keeps one id until it is finished. Every contact it writes is recorded with a
// content fingerprint, and rows are matched by CONTENT, not by position. So:
//   * a retry of the same file writes nothing again,
//   * a corrected file (invalid rows fixed, rows inserted, removed or reordered) writes only the rows that are new, and
//     never a row that is already written, and never discards a distinct row,
//   * a row whose content changed at a position already written is HELD, not written, until the user explicitly imports it.
// Each new row's idempotency key is '<attemptId>:<fingerprint>:<occurrence>', where the occurrence counts identical rows.
// A second, intentional import is a NEW attempt. It starts only after the previous one finished, or after the user chooses
// "Start a new import". Nothing here decides that two rows are the same contact from an email, phone or filename.

import type { ImportAttempt, WrittenRow } from '../types';

/** A new attempt with nothing written. `newId` is supplied by the caller (crypto.randomUUID in the app, a fixed id in tests). */
export function startImportAttempt(newId: () => string): ImportAttempt {
  return { attemptId: newId(), written: [] };
}

/**
 * A deterministic fingerprint of a row's content. It is not an identity: it only says that two rows have the same content.
 * Two 32-bit FNV-style hashes (no BigInt: the build targets es5).
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

function isWrittenRow(value: unknown): value is WrittenRow {
  const v = value as WrittenRow;
  return !!v && typeof v.fingerprint === 'string' && typeof v.position === 'number';
}

/** The open attempt for this user in this tab, if any. Survives a page reload; null when storage is unavailable or damaged. */
export function loadOpenAttempt(userId: string): ImportAttempt | null {
  try {
    const raw = sessionStore()?.getItem(storageKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ImportAttempt>;
    if (typeof value.attemptId !== 'string' || !Array.isArray(value.written) || !value.written.every(isWrittenRow)) return null;
    return { attemptId: value.attemptId, written: value.written };
  } catch {
    return null;
  }
}

/** Stores the open attempt, or removes it when `attempt` is null (the import finished or the user started a new one). */
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

/** How many contacts the open import has written. 0 when there is no open import. */
export function openAttemptRowCount(userId: string): number {
  return loadOpenAttempt(userId)?.written.length ?? 0;
}
