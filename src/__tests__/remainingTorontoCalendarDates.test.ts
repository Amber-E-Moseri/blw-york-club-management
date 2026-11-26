import fs from 'fs';
import path from 'path';
import { shiftDateKey, toLocalDateKey } from '../lib/dates';

const root = path.resolve(__dirname, '..');
const calendarDateModules = [
  'hooks/useHabits.ts',
  'lib/queries/habits.ts',
  'components/feature/ContactForm.tsx',
  'components/feature/ContactFilters.tsx',
  'components/feature/QuickAddModal.tsx',
  'components/feature/MeetingForm.tsx',
  'lib/queries/contacts.ts',
  'lib/queries/people.ts',
  'lib/queries/confessions.ts',
  'pages/DailyConfessions.tsx',
  'lib/queries/books.ts',
  'pages/BookOfMonth.tsx',
  'lib/email/emailTemplates.ts',
];

test.each(calendarDateModules)('%s does not derive calendar keys from UTC ISO timestamps', (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  expect(source).not.toMatch(/new Date\(\)\.toISOString\(\)\.(?:split\('T'\)\[0\]|slice\(0,\s*10\))/);
});

test('Toronto calendar arithmetic crosses DST, month, and year boundaries without shifting a day', () => {
  expect(toLocalDateKey(new Date('2026-03-09T03:30:00Z'))).toBe('2026-03-08');
  expect(shiftDateKey('2026-03-08', 1)).toBe('2026-03-09');
  expect(shiftDateKey('2026-11-01', 1)).toBe('2026-11-02');
  expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  expect(shiftDateKey('2027-01-01', -1)).toBe('2026-12-31');
});
