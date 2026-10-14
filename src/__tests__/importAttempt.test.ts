import {
  startImportAttempt,
  openOrStartAttempt,
  loadOpenAttempt,
  saveOpenAttempt,
  openAttemptRowCount,
} from '../lib/importAttempt';

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('import attempt identity and storage', () => {
  it('a new import starts with a fresh id and nothing written', () => {
    expect(startImportAttempt(() => 'att-1')).toEqual({ attemptId: 'att-1', written: [] });
  });

  it('the open attempt is reused by a later upload of the same user until it is cleared', () => {
    const newId = jest.fn(() => 'att-1');
    const first = openOrStartAttempt('user-1', newId);
    saveOpenAttempt('user-1', { ...first, written: [{ fingerprint: 'fp', position: 1 }] });

    const retry = openOrStartAttempt('user-1', newId);
    expect(retry.attemptId).toBe('att-1');
    expect(retry.written).toEqual([{ fingerprint: 'fp', position: 1 }]);
    expect(newId).toHaveBeenCalledTimes(1);
  });

  it('clearing the open attempt makes the next upload a separate import with a new id', () => {
    let n = 0;
    const newId = () => `att-${++n}`;
    saveOpenAttempt('user-1', openOrStartAttempt('user-1', newId));
    saveOpenAttempt('user-1', null);
    expect(openOrStartAttempt('user-1', newId).attemptId).toBe('att-2');
  });

  it('an open attempt belongs to one user; another user starts their own', () => {
    let n = 0;
    const newId = () => `att-${++n}`;
    saveOpenAttempt('user-1', openOrStartAttempt('user-1', newId));
    expect(openOrStartAttempt('user-2', newId).attemptId).toBe('att-2');
  });

  it('the open attempt survives a reload of the page and reports how many contacts it has written', () => {
    saveOpenAttempt('user-1', {
      attemptId: 'att-R',
      written: [{ fingerprint: 'fp2', position: 2 }, { fingerprint: 'fp5', position: 5 }],
    });
    expect(loadOpenAttempt('user-1')?.attemptId).toBe('att-R');
    expect(openAttemptRowCount('user-1')).toBe(2);
  });

  it('a damaged stored value is ignored, and the import starts again instead of throwing', () => {
    window.sessionStorage.setItem('blwyork.importAttempt.user-1', '{not json');
    expect(loadOpenAttempt('user-1')).toBeNull();
    expect(openOrStartAttempt('user-1', () => 'att-fresh').attemptId).toBe('att-fresh');
  });

  it('a stored value with a malformed written list is ignored', () => {
    window.sessionStorage.setItem('blwyork.importAttempt.user-1', JSON.stringify({ attemptId: 'x', written: [{ bad: true }] }));
    expect(loadOpenAttempt('user-1')).toBeNull();
  });
});
