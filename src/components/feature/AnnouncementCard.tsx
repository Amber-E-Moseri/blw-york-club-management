import React from 'react';
import { formatRelativeTime } from '../../lib/utils';
import type { Announcement } from '../../types';

interface AnnouncementCardProps {
  announcement: Announcement;
}

export const AnnouncementCard: React.FC<AnnouncementCardProps> = ({ announcement }) => (
  <div className="flex gap-3 py-3 border-b border-gray-100 dark:border-slate-800 last:border-0">
    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${announcement.is_read ? 'bg-gray-300' : 'bg-york-600'}`} />
    <div className="min-w-0">
      <p className="text-small font-bold text-gray-900 dark:text-slate-100">{announcement.title}</p>
      <p className="text-tiny text-gray-500 mt-0.5 line-clamp-2">{announcement.body}</p>
      <p className="text-tiny text-gray-400 mt-1">
        {announcement.author_name} · {formatRelativeTime(announcement.created_at)}
      </p>
    </div>
  </div>
);
