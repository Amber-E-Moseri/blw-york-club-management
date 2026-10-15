import React from 'react';
import { cn } from '../../lib/utils';
import { Badge } from '../foundation/Badge';
import type { WeeklyMessage } from '../../types';

interface Props {
  message: WeeklyMessage;
  canEdit: boolean;
  onEdit?: (m: WeeklyMessage) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sMonth = s.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const eStr = s.getMonth() === e.getMonth()
    ? e.toLocaleDateString('en-CA', { day: 'numeric' })
    : e.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return `${sMonth} – ${eStr}`;
}

export const WeeklyMessageCard: React.FC<Props> = ({
  message: m, canEdit, onEdit, onDelete, compact = false,
}) => (
  <div
    className={cn(
      'bg-white border rounded-lg transition-shadow hover:shadow-sm dark:bg-slate-800 dark:border-slate-700',
      m.scope === 'org' ? 'border-york-200' : 'border-gray-200',
      compact ? 'p-4' : 'p-5',
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={m.scope === 'org' ? 'primary' : 'light'} size="small">
          {m.scope === 'org' ? 'Org' : 'Personal'}
        </Badge>
        <span className="text-xs text-gray-400">{formatWeekRange(m.week_start, m.week_end)}</span>
      </div>
      {canEdit && (
        <div className="flex gap-1 shrink-0">
          {onEdit && (
            <button
              onClick={() => onEdit(m)}
              className="p-1.5 rounded text-gray-400 hover:text-york-600 hover:bg-red-50 transition-colors"
              title="Edit"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => window.confirm('Delete this message?') && onDelete(m.id)}
              className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>

    <h3 className={cn('font-bold text-gray-900 mt-2', compact ? 'text-sm' : 'text-base')}>
      {m.title}
    </h3>

    <p className={cn('text-gray-600 leading-relaxed mt-1 whitespace-pre-wrap', compact ? 'text-xs line-clamp-3' : 'text-sm')}>
      {m.body}
    </p>

    {m.drive_link && (
      <a
        href={m.drive_link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 mt-3 text-sm text-blue-600 hover:underline font-medium"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        Open Drive Link
      </a>
    )}

    {!compact && (
      <p className="mt-3 text-xs text-gray-400">
        By {m.author_name}
      </p>
    )}
  </div>
);
