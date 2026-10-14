// One import ATTEMPT is one user action on the upload button. The attempt id is created once, when the user starts a
// new import. A retry of that same attempt (for example after a failed or uncertain response) reuses the id, so the
// database replays completed rows instead of writing them again. A new import, even with identical rows, gets a new id.
// The id is never derived from the clock or from random values inside a retry.

export interface ImportAttempt {
  attemptId: string;
  /** What is being imported (rows and uploader). Used only to decide whether this is a retry of the same upload. */
  signature: string;
  /** True once every row of this attempt is confirmed. A later import of the same rows is a new attempt. */
  completed: boolean;
}

/**
 * Returns the attempt to use for this submission. The previous attempt is reused only when it has the same signature and
 * is not yet complete. Otherwise a new id is created with `newId`, which the caller supplies (crypto.randomUUID in the app).
 */
export function nextImportAttempt(
  previous: ImportAttempt | null,
  signature: string,
  newId: () => string,
): ImportAttempt {
  if (previous && !previous.completed && previous.signature === signature) {
    return previous;
  }
  return { attemptId: newId(), signature, completed: false };
}

/** Marks the attempt complete when no row failed. A failed attempt stays open, so a retry reuses its id. */
export function recordImportResult(attempt: ImportAttempt, failed: number): ImportAttempt {
  return { ...attempt, completed: failed === 0 };
}
