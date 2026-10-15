import React from 'react';
import { Flame } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../foundation/Button';
import type { HabitWithStats } from '../../types';

interface Props {
  habit: HabitWithStats;
  onCheckIn: (templateId: string, status: 'done' | 'skipped') => void;
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

function getDayLabel(dateStr: string): string {
  return DAY_LABELS[new Date(dateStr + 'T00:00:00').getDay()];
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().split('T')[0];
}

const statusClasses: Record<string, string> = {
  done: 'bg-green-500 border-green-500',
  skipped: 'bg-amber-400 border-amber-400',
};

export const HabitCard: React.FC<Props> = ({ habit: h, onCheckIn }) => {
  const { template: t, entries, streak, completion_rate_7d, today_status } = h;
  const last7 = getLast7Days();
  const pct = Math.round(completion_rate_7d * 100);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4 hover:shadow-sm transition-shadow dark:bg-slate-800 dark:border-slate-700">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none" aria-hidden="true">{t.icon}</span>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">{t.name}</h3>
            {t.description && (
              <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>
            )}
          </div>
        </div>
        {streak > 0 && (
          <div className="flex items-center gap-1 shrink-0 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1 dark:bg-orange-900/20 dark:border-orange-800">
            <Flame className="w-3.5 h-3.5 text-orange-500" aria-hidden="true" />
            <span className="text-xs font-bold text-orange-700 dark:text-orange-400">{streak}</span>
          </div>
        )}
      </div>

      {/* 7-day grid */}
      <div className="flex gap-1.5 justify-between">
        {last7.map((dateStr) => {
          const status = isToday(dateStr) ? today_status : (entries[dateStr] ?? 'missed');
          const isPast = !isToday(dateStr) && new Date(dateStr) < new Date();
          return (
            <div key={dateStr} className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'w-7 h-7 rounded-full border-2 flex items-center justify-center text-white text-[10px] font-bold',
                  status === 'done' ? statusClasses.done
                    : status === 'skipped' ? statusClasses.skipped
                    : isPast ? 'border-gray-200 bg-gray-100'
                    : isToday(dateStr) ? 'border-york-300 bg-york-50'
                    : 'border-gray-100 bg-gray-50',
                )}
                title={`${dateStr}: ${status}`}
              >
                {status === 'done' && '✓'}
                {status === 'skipped' && '–'}
              </div>
              <span className={cn(
                'text-[9px] font-medium',
                isToday(dateStr) ? 'text-york-600' : 'text-gray-400',
              )}>
                {getDayLabel(dateStr)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Completion rate bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Last 7 days</span>
          <span className="font-medium text-gray-600">{pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Today's check-in */}
      <div className="flex gap-2 pt-1 border-t border-gray-100 dark:border-slate-700">
        <Button
          size="small"
          variant={today_status === 'done' ? 'success' : 'secondary'}
          onClick={() => onCheckIn(t.id, 'done')}
          className="flex-1"
        >
          {today_status === 'done' ? '✓ Done' : 'Mark Done'}
        </Button>
        <Button
          size="small"
          variant={today_status === 'skipped' ? 'warning' : 'ghost'}
          onClick={() => onCheckIn(t.id, 'skipped')}
          className="flex-1"
        >
          {today_status === 'skipped' ? '– Skipped' : 'Skip'}
        </Button>
      </div>
    </div>
  );
};
