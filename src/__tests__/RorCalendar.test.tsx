import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RorCalendar } from '../components/feature/RorCalendar';

// October 2025 starts on a Wednesday, so three blank cells come before day 1.
test('aligns day 1 under its real weekday', () => {
  const html = renderToStaticMarkup(
    <RorCalendar totalDays={31} readDates={[]} month={10} year={2025} />,
  );

  expect(html).toContain(
    '<span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>' +
      '<div role="img" aria-label="Day 1, missed"',
  );
});

test('marks completed days from readDates and leaves the rest missed', () => {
  const html = renderToStaticMarkup(
    <RorCalendar totalDays={31} readDates={['2025-10-02']} month={10} year={2025} />,
  );

  expect(html).toContain('aria-label="Day 2, completed"');
  expect(html).toContain('aria-label="Day 3, missed"');
  expect(html).toContain('1 of 31 read');
});

test('shows days in a future month as upcoming, not missed', () => {
  const html = renderToStaticMarkup(
    <RorCalendar totalDays={31} readDates={[]} month={1} year={2099} />,
  );

  expect(html).toContain('aria-label="Day 15, upcoming"');
  expect(html).not.toContain('aria-label="Day 15, missed"');
});

test('shows an empty-state message when nothing has been read this month', () => {
  const html = renderToStaticMarkup(
    <RorCalendar totalDays={31} readDates={[]} month={10} year={2025} />,
  );

  expect(html).toContain('No readings logged for this month yet.');
});
