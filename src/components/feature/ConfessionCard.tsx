import React from 'react';
import { CheckCircle, Heart } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../foundation/Button';
import { Badge } from '../foundation/Badge';
import type { Confession } from '../../types';

interface Props {
  confession: Confession;
  userId?: string;
  onDeclare: (id: string) => void;
  onUndeclare: (id: string) => void;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
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
        'bg-white border rounded-lg p-5 transition-all duration-200 dark:bg-slate-800',
        declared ? 'border-green-300 bg-green-50/40 dark:border-green-700 dark:bg-green-900/20' : 'border-gray-200 dark:border-slate-700'
      )}
    >
      {/* Date + count */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={declared ? 'success' : 'light'} size="small">
            {c.scheduled_date}
          </Badge>
          {(c.declaration_count ?? 0) > 0 && (
            <span className="text-xs text-gray-400">
              {c.declaration_count} declared
            </span>
          )}
        </div>
        {canDelete && onDelete && (
          <button
            onClick={() => window.confirm('Delete this confession?') && onDelete(c.id)}
            className="text-gray-300 hover:text-red-500 transition-colors text-sm"
            aria-label="Delete confession"
          >
            ✕
          </button>
        )}
      </div>

      {/* Title */}
      <h3 className="text-base font-bold text-gray-900 dark:text-slate-100 mb-2">{c.title}</h3>

      {/* Body */}
      <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap mb-4">
        {c.body}
      </p>

      {/* Declare button */}
      {userId && (
        <Button
          variant={declared ? 'secondary' : 'primary'}
          size="small"
          onClick={() => declared ? onUndeclare(c.id) : onDeclare(c.id)}
          icon={declared ? <CheckCircle className="w-4 h-4" /> : <Heart className="w-4 h-4" />}
        >
          {declared ? 'Declared!' : 'I Declare This'}
        </Button>
      )}
    </div>
  );
};
