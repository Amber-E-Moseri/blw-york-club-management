import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type DayState = 'completed' | 'missed' | 'upcoming' | 'today';

export const RorCalendar: React.FC<Props> = ({ totalDays, readDates, month, year, className }) => {
  const readSet = useMemo(() => new Set(readDates), [readDates]);
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();
  const isCurrentMonth = todayYear === year && todayMonth === month;

  const days = Array.from({ length: totalDays }, (_, i) => i + 1);
  // Leading blanks so day 1 sits under its real weekday.
  const leadingBlanks = new Date(year, month - 1, 1).getDay();

  // Build the ISO date string for each day in this devotional's month
  function isoForDay(d: number) {
    return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function stateFor(d: number): DayState {
    const done = readSet.has(isoForDay(d));
    if (done) return 'completed';
    const isFuture =
      year > todayYear ||
      (year === todayYear && month > todayMonth) ||
      (isCurrentMonth && d > todayDay);
    if (isFuture) return 'upcoming';
    if (isCurrentMonth && d === todayDay) return 'today';
    return 'missed';
  }

  const completedCount = days.filter((d) => readSet.has(isoForDay(d))).length;
  const stateLabel: Record<DayState, string> = {
    completed: 'completed',
    missed: 'missed',
    upcoming: 'upcoming',
    today: 'today, not yet read',
  };

  return (
    <div className={cn('rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4', className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Reading history — {MONTH_NAMES[month - 1]} {year}
        </h3>
        <p className="text-xs text-gray-500 dark:text-slate-400">
          {completedCount} of {totalDays} read
        </p>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center" aria-hidden="true">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
            {weekday.charAt(0)}
          </span>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-1.5"
        role="group"
        aria-label={`Reading history for ${MONTH_NAMES[month - 1]} ${year}`}
      >
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {days.map((d) => {
          const state = stateFor(d);
          return (
            <div
              key={d}
              role="img"
              aria-label={`Day ${d}, ${stateLabel[state]}`}
              className={cn(
                'aspect-square flex items-center justify-center rounded-lg text-xs font-semibold select-none',
                state === 'completed' && 'bg-emerald-500 text-white',
                state === 'missed' && 'border border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400',
                state === 'upcoming' && 'bg-gray-50 text-gray-300 dark:bg-slate-700/50 dark:text-slate-600',
                state === 'today' && 'bg-york-50 text-york-700 ring-2 ring-york-600 dark:bg-slate-700 dark:text-york-300',
              )}
            >
              {state === 'completed' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : d}
            </div>
          );
        })}
      </div>

      {readDates.length === 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">No readings logged for this month yet.</p>
      )}

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500 dark:text-slate-400" aria-label="Calendar key">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-emerald-500" aria-hidden="true" />
          Completed
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-gray-300 dark:border-slate-500" aria-hidden="true" />
          Missed
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-gray-100 dark:bg-slate-700" aria-hidden="true" />
          Upcoming
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded ring-2 ring-york-600" aria-hidden="true" />
          Today
        </li>
      </ul>
    </div>
  );
};
