import { format, isValid, parse } from 'date-fns';

export const AFFIRMATION_TITLE_MAX = 100;

export interface AffirmationImportRow {
  title: string;
  body: string;
  scheduled_date: string; // yyyy-MM-dd
  created_by: string;
}

const DATE_FORMATS = ['yyyy-MM-dd', 'MMMM d, yyyy', 'MMMM d yyyy', 'MMM d, yyyy', 'MMM d yyyy', 'M/d/yyyy'];

export function parseImportDate(value: string): string | null {
  const clean = value.trim();
  for (const pattern of DATE_FORMATS) {
    const parsed = parse(clean, pattern, new Date());
    if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
  }
  return null;
}

/** Splits one line into date, title and body. Tabs are preferred; " | " also works. */
function splitLine(line: string): string[] {
  const separator = line.includes('\t') ? '\t' : line.includes('|') ? '|' : null;
  if (!separator) return [line];
  const [first, second, ...rest] = line.split(separator);
  return rest.length ? [first, second, rest.join(separator)] : [first, second ?? ''];
}

/**
 * Reads pasted affirmations, one per line: `date<TAB>title<TAB>affirmation text`.
 * A header row ("Date  Title  Text") is skipped. Problems are reported per line and
 * nothing is returned as importable until every line is valid.
 */
export function parseAffirmationImport(
  text: string,
  createdBy: string
): { rows: AffirmationImportRow[]; errors: string[] } {
  const rows: AffirmationImportRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  text.split('\n').forEach((rawLine, index) => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) return;

    const parts = splitLine(line);
    if (parts.length < 3) {
      errors.push(`Line ${index + 1}: needs date, title and affirmation text separated by a tab or " | ".`);
      return;
    }
    const [dateText, titleText, bodyText] = parts.map((part) => part.trim());
    if (index === 0 && /^date$/i.test(dateText)) return;

    const scheduledDate = parseImportDate(dateText);
    if (!scheduledDate) {
      errors.push(`Line ${index + 1}: "${dateText}" is not a date. Use 2026-10-12 or October 12, 2026.`);
      return;
    }
    if (!titleText) {
      errors.push(`Line ${index + 1}: the title is empty.`);
      return;
    }
    if (titleText.length > AFFIRMATION_TITLE_MAX) {
      errors.push(`Line ${index + 1}: the title is longer than ${AFFIRMATION_TITLE_MAX} characters.`);
      return;
    }
    if (!bodyText) {
      errors.push(`Line ${index + 1}: the affirmation text is empty.`);
      return;
    }

    const key = `${scheduledDate}|${titleText.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`Line ${index + 1}: "${titleText}" is already listed for ${scheduledDate}.`);
      return;
    }
    seen.add(key);

    rows.push({ title: titleText, body: bodyText, scheduled_date: scheduledDate, created_by: createdBy });
  });

  return { rows, errors };
}
