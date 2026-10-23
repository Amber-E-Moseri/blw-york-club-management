import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { RorStreak } from '../../lib/queries/rorStreaks';
import { cn } from '../../lib/utils';

interface Props {
  streak: RorStreak | null;
  loading: boolean;
  error: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** id of the calendar panel this control expands. */
  panelId: string;
}

function dayCount(value: number): string {
  return `${value} ${value === 1 ? 'day' : 'days'}`;
}

/**
 * Phone-only summary of the member's own reading progress. Shows a skeleton while loading
 * and a message on error, and never substitutes zeros for unknown values.
 */
export const MobileReadingProgress: React.FC<Props> = ({
  streak, loading, error, expanded, onToggle, panelId,
}) => {
  return (
    <section aria-labelledby="my-reading-progress-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="my-reading-progress-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-slate-400">
          My reading progress
        </h2>
      </div>

      <div className="rounded-2xl bg-white p-4 dark:bg-slate-800">
        {loading ? (
          <div className="grid grid-cols-3 gap-3 motion-safe:animate-pulse" role="status" aria-label="Loading reading progress">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-16 rounded bg-gray-200 dark:bg-slate-700" />
                <div className="h-6 w-12 rounded bg-gray-200 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        ) : error || !streak ? (
          <p className="text-sm text-gray-500 dark:text-slate-400" role="status">
            Reading progress is unavailable right now.
          </p>
        ) : (
          <dl className="grid grid-cols-3 gap-3">
            <SummaryCell label="Current streak" value={dayCount(streak.current_streak)} accent />
            <SummaryCell label="Longest streak" value={dayCount(streak.longest_streak)} />
            <SummaryCell label="This month" value={`${streak.monthly_completed} / ${streak.monthly_total}`} />
          </dl>
        )}
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-york-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
      >
        {expanded ? 'Hide reading calendar' : 'View reading progress'}
        {expanded
          ? <ChevronUp className="h-4 w-4 text-gray-400" aria-hidden="true" />
          : <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />}
      </button>
    </section>
  );
};

const SummaryCell: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-semibold leading-tight text-gray-500 dark:text-slate-400">{label}</dt>
    <dd className={cn(
      'mt-1 text-base font-bold leading-tight text-gray-900 dark:text-white',
      accent && 'text-york-700 dark:text-york-300',
    )}>
      {value}
    </dd>
  </div>
);
