import React from 'react';
import { Button } from '../foundation/Button';
import { formatRelativeTime } from '../../lib/utils';
import type { Announcement } from '../../types';

interface AnnouncementCardProps {
  announcement: Announcement;
  /** Shown only to users who may manage announcements. Omit both for read-only cards. */
  onEdit?: (announcement: Announcement) => void;
  onDelete?: (announcement: Announcement) => void;
}

export const AnnouncementCard: React.FC<AnnouncementCardProps> = ({ announcement, onEdit, onDelete }) => (
  <div className="py-3 border-b border-gray-100 last:border-0">
    <div className="min-w-0">
      <p className="text-small font-bold text-gray-900">{announcement.title}</p>
      <p className="text-tiny text-gray-500 mt-0.5 line-clamp-2">{announcement.body}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-1">
        <p className="text-tiny text-gray-400">
          {announcement.author_name} · {formatRelativeTime(announcement.created_at)}
        </p>
        {(onEdit || onDelete) && (
          <div className="flex gap-1">
            {onEdit && (
              <Button
                variant="ghost"
                size="small"
                onClick={() => onEdit(announcement)}
                aria-label={`Edit announcement: ${announcement.title}`}
              >
                Edit
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="small"
                className="text-red-700"
                onClick={() => onDelete(announcement)}
                aria-label={`Delete announcement: ${announcement.title}`}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
);
