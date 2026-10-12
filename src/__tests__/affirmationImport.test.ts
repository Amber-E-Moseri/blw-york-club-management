import { parseAffirmationImport, parseImportDate } from '../lib/affirmationImport';

const USER = 'user-1';

describe('parseImportDate', () => {
  test('accepts ISO and long-form dates', () => {
    expect(parseImportDate('2026-10-12')).toBe('2026-10-12');
    expect(parseImportDate('October 12, 2026')).toBe('2026-10-12');
    expect(parseImportDate('Oct 12 2026')).toBe('2026-10-12');
  });

  test('rejects text that is not a date', () => {
    expect(parseImportDate('next Tuesday')).toBeNull();
    expect(parseImportDate('2026-13-40')).toBeNull();
  });
});

describe('parseAffirmationImport', () => {
  test('reads tab-separated lines and skips a header', () => {
    const text = [
      'Date\tTitle\tText',
      '2026-10-12\tGod is my provider\tI declare that I lack nothing.',
      'October 13, 2026\tPeace over my mind\tI declare peace.',
    ].join('\n');
    const { rows, errors } = parseAffirmationImport(text, USER);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { title: 'God is my provider', body: 'I declare that I lack nothing.', scheduled_date: '2026-10-12', created_by: USER },
      { title: 'Peace over my mind', body: 'I declare peace.', scheduled_date: '2026-10-13', created_by: USER },
    ]);
  });

  test('accepts pipe separators and keeps extra pipes in the text', () => {
    const { rows, errors } = parseAffirmationImport('2026-10-12 | Title | Part one | part two', USER);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ title: 'Title', body: 'Part one | part two' });
  });

  test('reports each bad line instead of returning partial rows as valid', () => {
    const text = [
      '2026-10-12\tGood\tText',
      'someday\tBad date\tText',
      '2026-10-14\t\tNo title',
      '2026-10-15\tNo text\t',
      '2026-10-16 only two',
    ].join('\n');
    const { rows, errors } = parseAffirmationImport(text, USER);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain('Line 2');
    expect(errors[1]).toContain('title is empty');
    expect(errors[2]).toContain('affirmation text is empty');
    expect(errors[3]).toContain('needs date, title and affirmation text');
  });

  test('flags a title repeated on the same day', () => {
    const text = '2026-10-12\tSame\tOne\n2026-10-12\tsame\tTwo';
    const { errors } = parseAffirmationImport(text, USER);
    expect(errors).toEqual(['Line 2: "same" is already listed for 2026-10-12.']);
  });

  test('flags titles longer than 100 characters', () => {
    const long = 'x'.repeat(101);
    const { errors } = parseAffirmationImport(`2026-10-12\t${long}\tText`, USER);
    expect(errors[0]).toContain('longer than 100 characters');
  });
});
