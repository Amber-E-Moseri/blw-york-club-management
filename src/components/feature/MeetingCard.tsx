import React from 'react';
import { Building2, BookOpen, Users, Star, Calendar, Clock, MapPin, Video, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from '../foundation/Badge';
import { Button } from '../foundation/Button';
import type { Meeting } from '../../types';

interface Props {
  meeting: Meeting;
  canManage: boolean;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onEdit?: (m: Meeting) => void;
  onDelete?: (id: string) => void;
}

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h % 12) || 12)}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function isToday(d: string) { return d === new Date().toISOString().split('T')[0]; }
function isTomorrow(d: string) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  return d === t.toISOString().split('T')[0];
}
function dayLabel(d: string) {
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });
}

const CAT_BADGE: Record<string, { variant: string; label: string; icon: LucideIcon }> = {
  general:    { variant: 'info',    label: 'General',    icon: Building2 },
  bsc:        { variant: 'success', label: 'BSC',        icon: BookOpen },
  cell:       { variant: 'warning', label: 'Cell',       icon: Users },
  leadership: { variant: 'error',   label: 'Leadership', icon: Star },
};

export const MeetingCard: React.FC<Props> = ({
  meeting: m, canManage, onConfirm, onCancel, onEdit, onDelete,
}) => (
  <div
    className={cn(
      'bg-white border rounded-lg p-5 space-y-3 hover:shadow-sm transition-shadow dark:bg-slate-800',
      isToday(m.date) ? 'border-york-600/30 dark:border-york-600/40' : 'border-gray-200 dark:border-slate-700'
    )}
  >
    {/* Top bar */}
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {isToday(m.date) && <Badge variant="primary" size="small">Today</Badge>}
          {(() => {
            const cat = CAT_BADGE[m.category ?? 'general'];
            const CatIcon = cat.icon;
            return (
              <Badge variant={cat.variant as 'info' | 'success' | 'warning' | 'error'} size="small">
                <CatIcon className="w-3 h-3 mr-1 inline-block" />{cat.label}
              </Badge>
            );
          })()}
          {m.allow_join_requests && (
            <Badge variant="gray" size="small">Open to join</Badge>
          )}
        </div>
        <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">{m.title}</h3>
      </div>
      {canManage && (
        <div className="flex gap-1 shrink-0">
          {onEdit && (
            <button onClick={() => onEdit(m)} className="p-1.5 rounded text-gray-400 hover:text-york-600 hover:bg-red-50 transition-colors" title="Edit">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button onClick={() => window.confirm('Delete meeting?') && onDelete(m.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>

    {/* Date & time */}
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-slate-300">
      <span className="flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-slate-500" />
        <span className="font-medium">{dayLabel(m.date)}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-slate-500" />
        {formatTime(m.time)}{m.end_time ? ` – ${formatTime(m.end_time)}` : ''}
      </span>
      {m.location && (
        <span className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-slate-500" />{m.location}
        </span>
      )}
    </div>

    {m.zoom_link && (
      <a
        href={m.zoom_link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
      >
        <Video className="w-3.5 h-3.5" /> Join Online
      </a>
    )}

    {m.description && (
      <p className="text-sm text-gray-500 leading-relaxed">{m.description}</p>
    )}

    {/* Footer */}
    <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-700">
      <p className="text-xs text-gray-400">
        {typeof m.attendance_count === 'number' ? `${m.attendance_count} confirmed` : 'Attendance'}
      </p>
      <Button
        size="small"
        variant={m.user_confirmed ? 'secondary' : 'primary'}
        onClick={() => m.user_confirmed ? onCancel(m.id) : onConfirm(m.id)}
      >
        {m.user_confirmed ? '✓ Confirmed' : 'Confirm Attendance'}
      </Button>
    </div>
  </div>
);
