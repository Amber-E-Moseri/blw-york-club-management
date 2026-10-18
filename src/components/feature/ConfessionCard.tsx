import React from 'react';
import { CheckCircle, Heart, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Affirmation as Confession } from '../../types';

interface Props {
  confession: Confession;
  userId?: string;
  onDeclare: (id: string) => void;
  onUndeclare: (id: string) => void;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
}

/** "2026-10-17" → "Oct 17", parsed as a local date so the day never shifts. */
function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export const ConfessionCard: React.FC<Props> = ({
  confession: c,
  userId,
  onDeclare,
  onUndeclare,
  canDelete,
  onDelete,
}) => {
  const declared = c.declared_by_me ?? false;

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-5 shadow-sm transition-colors duration-200 dark:bg-slate-800',
        declared
          ? 'border-green-300 bg-green-50/60 dark:border-green-700 dark:bg-green-900/20'
          : 'border-gray-200 dark:border-slate-700',
      )}
    >
      {/* Date + count */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
              declared
                ? 'bg-green-700 text-white'
                : 'bg-york-50 text-york-700 dark:bg-york-900/30 dark:text-york-300',
            )}
          >
            {formatShortDate(c.scheduled_date)}
          </span>
          {(c.declaration_count ?? 0) > 0 && (
            <span className="text-xs text-gray-500 dark:text-slate-400">
              {c.declaration_count} declared
            </span>
          )}
        </div>
        {canDelete && onDelete && (
          <button
            type="button"
            onClick={() => window.confirm('Delete this confession?') && onDelete(c.id)}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
            aria-label="Delete confession"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Title */}
      <h3 className="mt-3 text-lg font-bold text-gray-900 dark:text-slate-100">{c.title}</h3>

      {/* Body */}
      <p className="mt-2 text-[15px] leading-relaxed text-gray-600 dark:text-slate-300 whitespace-pre-wrap">
        {c.body}
      </p>

      {/* Declare button */}
      {userId && (
        <button
          type="button"
          onClick={() => (declared ? onUndeclare(c.id) : onDeclare(c.id))}
          className={cn(
            'mt-4 flex w-full h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors',
            declared
              ? 'border border-green-600 bg-white text-green-700 hover:bg-green-50 dark:bg-slate-800 dark:text-green-400 dark:hover:bg-green-900/30'
              : 'bg-york-600 text-white shadow-sm hover:bg-york-700 active:bg-york-800',
          )}
        >
          {declared ? <CheckCircle className="w-4 h-4" /> : <Heart className="w-4 h-4" />}
          {declared ? 'Declared' : 'I declare this'}
        </button>
      )}
    </div>
  );
};
