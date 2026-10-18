import React from 'react';
import { Flame, Trophy, Calendar, CheckCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { RorStreak } from '../../lib/queries/rorStreaks';

interface Props {
  streak: RorStreak;
  className?: string;
  compact?: boolean;
}

export const RorStreakBadge: React.FC<Props> = ({ streak, className, compact = false }) => {
  const pct = streak.monthly_total > 0
    ? Math.round((streak.monthly_completed / streak.monthly_total) * 100)
    : 0;

  if (compact) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <span className="flex items-center gap-1 text-sm font-semibold text-orange-500">
          <Flame className="w-4 h-4" aria-hidden="true" />
          {streak.current_streak}d
        </span>
        <span className="flex items-center gap-1 text-sm font-semibold text-emerald-600">
          <CheckCircle className="w-4 h-4" aria-hidden="true" />
          {pct}%
        </span>
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4', className)}>
      <StatTile
        icon={<Flame className="w-5 h-5 text-orange-500" aria-hidden="true" />}
        label="Current streak"
        value={`${streak.current_streak} day${streak.current_streak !== 1 ? 's' : ''}`}
        highlight={streak.current_streak > 0}
      />
      <StatTile
        icon={<Trophy className="w-5 h-5 text-amber-500" aria-hidden="true" />}
        label="Longest streak"
        value={`${streak.longest_streak} day${streak.longest_streak !== 1 ? 's' : ''}`}
      />
      <StatTile
        icon={<Calendar className="w-5 h-5 text-blue-500" aria-hidden="true" />}
        label="This month"
        value={`${streak.monthly_completed} / ${streak.monthly_total}`}
      />
      <StatTile
        icon={<CheckCircle className="w-5 h-5 text-emerald-500" aria-hidden="true" />}
        label="Completion"
        value={`${pct}%`}
        highlight={pct >= 80}
      />
    </div>
  );
};

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}> = ({ icon, label, value, highlight }) => (
  <div className={cn(
    'rounded-2xl border px-3 py-2.5 sm:px-4 sm:py-3 bg-white dark:bg-slate-800',
    highlight
      ? 'border-emerald-200 dark:border-emerald-700'
      : 'border-gray-200 dark:border-slate-700',
  )}>
    <div className="flex items-center gap-1.5 mb-1 min-w-0">
      <span className="shrink-0">{icon}</span>
      <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 truncate">{label}</span>
    </div>
    <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white leading-none truncate">{value}</p>
  </div>
);
