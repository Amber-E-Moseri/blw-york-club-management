import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  /** Days in the month's devotional (1..total_days). */
  totalDays: number;
  /** Calendar dates on which the member completed reading, as 'YYYY-MM-DD'. */
  readDates: string[];
  /** The devotional's month (1-12) and year, for label only. */
  month: number;
  year: number;
  className?: string;
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

export const RorCalendar: React.FC<Props> = ({ totalDays, readDates, month, year, className }) => {
  const readSet = useMemo(() => new Set(readDates), [readDates]);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = today.getDate();

  const days = Array.from({ length: totalDays }, (_, i) => i + 1);

  // Build the ISO date string for each day in this devotional's month
  function isoForDay(d: number) {
    return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return (
    <div className={cn('rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4', className)}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
        Reading History — {MONTH_NAMES[month - 1]} {year}
      </h3>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
        role="grid"
        aria-label={`Reading history for ${MONTH_NAMES[month - 1]} ${year}`}
      >
        {days.map((d) => {
          const iso = isoForDay(d);
          const done = readSet.has(iso);
          const isFuture = isCurrentMonth && d > todayDay;
          return (
            <div
              key={d}
              role="gridcell"
              aria-label={`Day ${d}${done ? ' — completed' : isFuture ? ' — upcoming' : ' — missed'}`}
              className={cn(
                'aspect-square flex items-center justify-center rounded-lg text-xs font-semibold select-none',
                done
                  ? 'bg-emerald-500 text-white'
                  : isFuture
                    ? 'bg-gray-100 dark:bg-slate-700 text-gray-300 dark:text-slate-600'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400',
              )}
            >
              {d}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">
        <span className="inline-block w-2.5 h-2.5 rounded bg-emerald-500 mr-1 align-middle" aria-hidden="true" />
        Completed &nbsp;
        <span className="inline-block w-2.5 h-2.5 rounded bg-gray-200 dark:bg-slate-700 mr-1 align-middle ml-2" aria-hidden="true" />
        Not yet read
      </p>
    </div>
  );
};
