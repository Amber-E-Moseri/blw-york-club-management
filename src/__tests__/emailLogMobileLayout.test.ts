import fs from 'fs';
import path from 'path';

// Layout checks for the admin email log on phone widths. The page is checked structurally: the wrapper padding and the
// phone/tablet split. Visual checks are done on a preview deployment.
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8').replace(/\r\n/g, '\n');
const page = read('src/pages/AdminEmailLog.tsx');

describe('admin email log on phone widths', () => {
  test('the page wrapper uses 16px side padding below the sm breakpoint', () => {
    expect(page).toMatch(/<div className="flex-1 overflow-y-auto p-4 sm:p-8">/);
    expect(page).not.toMatch(/<div className="flex-1 overflow-y-auto p-8">/);
  });

  test('phones get one card per message, with no table', () => {
    expect(page).toMatch(/<ul className="space-y-3 sm:hidden">/);
    expect(page).toMatch(/<li key=\{log\.id\} className="space-y-2 rounded-md border border-gray-100 p-3">/);
  });

  test('the table is shown only from the sm breakpoint up', () => {
    expect(page).toMatch(/<div className="hidden overflow-x-auto sm:block">\s*<table/);
    expect(page).not.toMatch(/<div className="overflow-x-auto">\s*<table/);
  });

  test('the phone list and the table share one per-row action', () => {
    expect(page).toMatch(/const resendActionFor = \(log: EmailLog\) =>/);
    expect((page.match(/resendActionFor\(log\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('long subjects and addresses wrap instead of pushing the layout wider', () => {
    expect(page).toMatch(/break-words text-sm font-medium text-gray-900/);
    expect(page).toMatch(/break-all text-xs text-gray-700/);
  });
});
