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

describe('import attempt identity', () => {
  it('a new import starts with a fresh id and no confirmed rows', () => {
    const attempt = startImportAttempt(() => 'att-1');
    expect(attempt).toEqual({ attemptId: 'att-1', confirmed: {} });
  });

  it('the open attempt is reused by a later upload of the same user until it is cleared', () => {
    const newId = jest.fn(() => 'att-1');
    const first = openOrStartAttempt('user-1', newId);
    saveOpenAttempt('user-1', { ...first, confirmed: { '1': 'fp' } });

    const retry = openOrStartAttempt('user-1', newId);
    expect(retry.attemptId).toBe('att-1');
    expect(retry.confirmed).toEqual({ '1': 'fp' });
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

  it('the open attempt survives a reload of the page (it is read back from session storage)', () => {
    saveOpenAttempt('user-1', { attemptId: 'att-R', confirmed: { '2': 'fp2', '5': 'fp5' } });
    expect(loadOpenAttempt('user-1')).toEqual({ attemptId: 'att-R', confirmed: { '2': 'fp2', '5': 'fp5' } });
    expect(openAttemptRowCount('user-1')).toBe(2);
  });

  it('a damaged stored value is ignored, and the import starts again instead of throwing', () => {
    window.sessionStorage.setItem('blwyork.importAttempt.user-1', '{not json');
    expect(loadOpenAttempt('user-1')).toBeNull();
    expect(openOrStartAttempt('user-1', () => 'att-fresh').attemptId).toBe('att-fresh');
  });
});
