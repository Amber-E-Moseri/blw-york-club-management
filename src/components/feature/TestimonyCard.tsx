import React, { useState } from 'react';
import { Banknote, HeartHandshake, Sparkles, Leaf, BookOpen, PenLine, Lock, Home, Users, Globe, type LucideIcon } from 'lucide-react';
import { Badge } from '../foundation/Badge';
import { formatRelativeTime } from '../../lib/utils';
import { TestimonyComments } from './TestimonyComments';
import type { Testimony, TestimonyCategory, ReactionType } from '../../types';
import type { AuthUser } from '../../lib/auth';

interface Props {
  testimony: Testimony;
  user?: AuthUser | null;
  onEdit?: (t: Testimony) => void;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
  onReact?: (id: string, type: ReactionType) => void;
  showAdminActions?: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

const CATEGORY_META: Record<TestimonyCategory, { label: string; icon: LucideIcon }> = {
  provision:       { label: 'Provision',       icon: Banknote       },
  healing:         { label: 'Healing',          icon: HeartHandshake },
  prayer_answered: { label: 'Prayer Answered',  icon: Sparkles       },
  growth:          { label: 'Spiritual Growth', icon: Leaf           },
  other:           { label: 'Other',            icon: BookOpen       },
};

const VISIBILITY_META: Record<string, { label: string; icon: LucideIcon }> = {
  draft:   { label: 'Draft',    icon: PenLine },
  private: { label: 'Private',  icon: Lock    },
  cell:    { label: 'Cell',     icon: Home    },
  members: { label: 'Members',  icon: Users   },
  public:  { label: 'Public',   icon: Globe   },
};

const STATUS_BADGE: Record<string, { label: string; variant: 'warning' | 'success' | 'error' }> = {
  pending:  { label: 'Pending Review', variant: 'warning' },
  rejected: { label: 'Rejected',       variant: 'error' },
  archived: { label: 'Archived',       variant: 'error' },
};

const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'heart', emoji: '❤️', label: 'Heart' },
  { type: 'fire',  emoji: '🔥', label: 'Fire'  },
  { type: 'pray',  emoji: '🙏', label: 'Pray'  },
];

export const TestimonyCard: React.FC<Props> = ({
  testimony: t, user, onEdit, onDelete, onArchive, onReact,
  showAdminActions, onApprove, onReject,
}) => {
  const [expanded, setExpanded]       = useState(false);
  const [showComments, setShowComments] = useState(false);
  const meta = CATEGORY_META[t.category];
  const visibilityMeta = VISIBILITY_META[t.visibility];
  const VisIcon = visibilityMeta?.icon;
  const CatIcon = meta.icon;
  const preview = t.body.length > 240 && !expanded ? t.body.slice(0, 240) + '…' : t.body;
  const statusInfo = t.status !== 'approved' ? STATUS_BADGE[t.status] : null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 hover:shadow-sm transition-shadow dark:bg-slate-800 dark:border-slate-700">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Entry type pill */}
          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
            t.entry_type === 'prophecy'
              ? 'bg-purple-100 text-purple-700'
              : 'bg-york-100 text-york-700'
          }`}>
            {t.entry_type === 'prophecy' ? 'Prophecy' : 'Testimony'}
          </span>
          <Badge variant="light">
            <span className="inline-flex items-center gap-1">
              <CatIcon className="w-3 h-3" />
              {meta.label}
            </span>
          </Badge>
          {VisIcon && (
            <span className="text-gray-400 dark:text-slate-500" title={`Visibility: ${t.visibility}`}>
              <VisIcon className="w-3.5 h-3.5" />
            </span>
          )}
          {statusInfo && (
            <Badge variant={statusInfo.variant} size="small">{statusInfo.label}</Badge>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 shrink-0">
          {t.is_mine && onEdit && (
            <button
              onClick={() => onEdit(t)}
              className="p-1.5 rounded text-gray-400 hover:text-york-600 hover:bg-red-50 transition-colors"
              title="Edit"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          {t.is_mine && onArchive && t.status === 'approved' && (
            <button
              onClick={() => window.confirm('Archive this entry?') && onArchive(t.id)}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Archive"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8" />
              </svg>
            </button>
          )}
          {t.is_mine && onDelete && (
            <button
              onClick={() => window.confirm('Delete this entry?') && onDelete(t.id)}
              className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">{t.title}</h3>

      {/* Image */}
      {t.image_url && (
        <img
          src={t.image_url}
          alt="Testimony"
          className="w-full max-h-64 object-cover rounded-lg"
        />
      )}

      {/* Body */}
      <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{preview}</p>
      {t.body.length > 240 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-york-600 hover:underline font-medium"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}

      {/* Reactions + comment count */}
      <div className="flex items-center gap-3 pt-1">
        {REACTIONS.map((r) => {
          const count = t.reaction_counts?.[r.type] ?? 0;
          const active = t.my_reactions?.includes(r.type);
          return (
            <button
              key={r.type}
              onClick={() => onReact?.(t.id, r.type)}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-all ${
                active
                  ? 'bg-york-50 text-york-700 font-semibold'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
              title={r.label}
              disabled={!onReact}
            >
              <span>{r.emoji}</span>
              {count > 0 && <span>{count}</span>}
            </button>
          );
        })}
        <button
          onClick={() => setShowComments((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-full text-xs text-gray-500 hover:bg-gray-100 transition-colors ml-auto"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span>{t.comment_count ?? 0}</span>
        </button>
      </div>

      {/* Admin moderation */}
      {showAdminActions && t.status === 'pending' && (
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={() => onApprove?.(t.id)}
            className="flex-1 py-1.5 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded-md transition-colors"
          >
            ✓ Approve
          </button>
          <button
            onClick={() => onReject?.(t.id)}
            className="flex-1 py-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors"
          >
            ✕ Reject
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-slate-700">
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400">{t.author_name}</p>
        <p className="text-xs text-gray-400 dark:text-slate-500">{formatRelativeTime(t.created_at)}</p>
      </div>

      {/* Comments section */}
      {showComments && <TestimonyComments testimonyId={t.id} user={user ?? null} />}
    </div>
  );
};
