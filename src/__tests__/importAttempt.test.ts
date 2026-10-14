import { nextImportAttempt, recordImportResult } from '../lib/importAttempt';

describe('import attempt identity', () => {
  it('a retry of an incomplete attempt with the same rows reuses the id and never asks for a new one', () => {
    const newId = jest.fn(() => 'attempt-1');
    const first = nextImportAttempt(null, 'sig-a', newId);
    const pending = recordImportResult(first, 2);
    const retry = nextImportAttempt(pending, 'sig-a', newId);
    expect(retry.attemptId).toBe(first.attemptId);
    expect(newId).toHaveBeenCalledTimes(1);
  });

  it('a second, intentionally new import with identical rows gets a new id once the first is complete', () => {
    let n = 0;
    const newId = () => `attempt-${++n}`;
    const first = nextImportAttempt(null, 'sig-a', newId);
    const done = recordImportResult(first, 0);
    const second = nextImportAttempt(done, 'sig-a', newId);
    expect(second.attemptId).not.toBe(first.attemptId);
  });

  it('a different file (different signature) never reuses an open attempt', () => {
    let n = 0;
    const newId = () => `attempt-${++n}`;
    const first = nextImportAttempt(null, 'sig-a', newId);
    const other = nextImportAttempt(recordImportResult(first, 1), 'sig-b', newId);
    expect(other.attemptId).not.toBe(first.attemptId);
  });

  it('a clean result marks the attempt complete, a failed result keeps it open for retry', () => {
    const a = nextImportAttempt(null, 'sig', () => 'id');
    expect(recordImportResult(a, 0).completed).toBe(true);
    expect(recordImportResult(a, 1).completed).toBe(false);
  });
});
