import {
  applyRangeEdit,
  applySchedule,
  detectPageRanges,
  parseSchedule,
  rangesFromFirstPage,
  validateRanges,
  type PageRange,
} from '../lib/pdf-converter';

const OCTOBER_SCHEDULE = [
  'Date\tTopic\tPages',
  "Thursday, October 1\tYou've Obtained Mercy\t6–7",
  'Friday, October 2\tHe Brought Us Unto Himself\t8–9',
  'Saturday, October 31\tYou\'re Already Dead to Sin\t66–67',
].join('\n');

// Monthly devotionals always have 28 to 31 days, so fixtures use a real month length.
function month(days: number, pagesPerDay = 2): PageRange[] {
  return detectPageRanges(days * pagesPerDay, days);
}

function firstPages(ranges: PageRange[], count: number) {
  return ranges.slice(0, count).map((r) => [r.startPage, r.endPage]);
}

describe('applyRangeEdit', () => {
  test('moving a day end shifts every later day and keeps its page count', () => {
    const result = applyRangeEdit(month(30), 2, 3, 5);
    if (!('ranges' in result)) throw new Error(result.error);
    expect(firstPages(result.ranges, 5)).toEqual([
      [1, 2],
      [3, 5],
      [6, 7],
      [8, 9],
      [10, 11],
    ]);
  });

  test('moving a day start moves the previous day end with it', () => {
    const result = applyRangeEdit(month(30), 2, 4, 4);
    if (!('ranges' in result)) throw new Error(result.error);
    expect(firstPages(result.ranges, 5)).toEqual([
      [1, 3],
      [4, 4],
      [5, 6],
      [7, 8],
      [9, 10],
    ]);
  });

  test('rejects a start that would not come after the previous day', () => {
    expect('error' in applyRangeEdit(month(30), 2, 1, 4)).toBe(true);
  });

  test('rejects an end before its start', () => {
    expect('error' in applyRangeEdit(month(30), 2, 4, 3)).toBe(true);
  });
});

describe('rangesFromFirstPage', () => {
  test('skips front matter so October starts on page 6 with two pages a day', () => {
    const ranges = rangesFromFirstPage(67, 31, 6);
    expect(ranges[0]).toMatchObject({ day: 1, startPage: 6, endPage: 7 });
    expect(ranges[30]).toMatchObject({ day: 31, startPage: 66, endPage: 67 });
    expect(validateRanges(ranges, 67)).toEqual([]);
  });
});

describe('parseSchedule', () => {
  test('reads day, title and pages from the pasted table', () => {
    const { rows, errors } = parseSchedule(OCTOBER_SCHEDULE, 10);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { day: 1, startPage: 6, endPage: 7, title: "You've Obtained Mercy" },
      { day: 2, startPage: 8, endPage: 9, title: 'He Brought Us Unto Himself' },
      { day: 31, startPage: 66, endPage: 67, title: "You're Already Dead to Sin" },
    ]);
  });

  test('reports a schedule for a different month', () => {
    const { rows, errors } = parseSchedule(OCTOBER_SCHEDULE, 11);
    expect(rows).toEqual([]);
    expect(errors[0]).toContain('is for October, but the month is set to November.');
  });
});

describe('applySchedule', () => {
  test('sets exact pages and titles for each listed day', () => {
    const base = rangesFromFirstPage(67, 31, 1);
    const { rows } = parseSchedule(OCTOBER_SCHEDULE, 10);
    const applied = applySchedule(base, rows);
    expect(applied[0]).toMatchObject({ day: 1, startPage: 6, endPage: 7, title: "You've Obtained Mercy" });
    expect(applied[1]).toMatchObject({ day: 2, startPage: 8, endPage: 9 });
  });
});

describe('validateRanges', () => {
  test('a generated split has no issues', () => {
    expect(validateRanges(month(31), 62)).toEqual([]);
  });

  test('reports overlaps and gaps', () => {
    const ranges: PageRange[] = [
      { day: 1, startPage: 1, endPage: 3 },
      { day: 2, startPage: 3, endPage: 4 },
      { day: 3, startPage: 6, endPage: 6 },
    ];
    const issues = validateRanges(ranges, 6);
    expect(issues).toContain('Day 2 overlaps Day 1 on page 3.');
    expect(issues).toContain('Pages 5–5 are not assigned to any day.');
  });

  test('reports ranges that run past the PDF', () => {
    expect(validateRanges([{ day: 1, startPage: 1, endPage: 9 }], 8)).toContain(
      'Day 1 goes past the last PDF page (8).'
    );
  });

  test('allows back matter after the last day', () => {
    expect(validateRanges([{ day: 1, startPage: 6, endPage: 7 }], 72)).toEqual([]);
  });
});
