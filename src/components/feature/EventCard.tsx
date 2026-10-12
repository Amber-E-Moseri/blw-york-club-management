import React from 'react';
import { formatEventDate } from '../../lib/utils';
import { buildGoogleCalendarUrl, downloadIcs } from '../../lib/calendar';
import { Badge, Button } from '../foundation';
import type { Event } from '../../types';

interface EventCardProps {
  event: Event;
  onRsvp?: (id: string) => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, onRsvp }) => {
  const { month, day } = formatEventDate(event.date);

  return (
    <div className="flex items-start gap-4 p-4">
      {/* Date bubble */}
      <div className="flex flex-col items-center justify-center w-12 h-14 bg-york-50 dark:bg-york-900/30 border border-york-200 dark:border-york-800 rounded-xl shrink-0">
        <span className="text-xs font-bold text-york-600 dark:text-york-400 uppercase leading-none">{month}</span>
        <span className="text-xl font-bold text-york-800 dark:text-york-200 leading-snug mt-0.5">{day}</span>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-slate-100 truncate">{event.title}</p>
        <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">{event.time} · {event.location}</p>
        <Badge variant="gray" className="mt-1">{event.category}</Badge>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold">
          <a
            href={buildGoogleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-york-700 underline underline-offset-2"
          >
            Add to Google Calendar
          </a>
          <button
            type="button"
            className="text-york-700 underline underline-offset-2"
            onClick={() => downloadIcs(event)}
          >
            Add to Apple / Outlook (.ics)
          </button>
        </div>
      </div>

      {/* RSVP */}
      {onRsvp && (
        event.user_rsvp ? (
          <span className="shrink-0 text-xs font-bold text-success border border-success rounded-md px-3 py-1">
            RSVP'd
          </span>
        ) : (
          <Button
            variant="primary"
            className="shrink-0 !py-1 !px-3 !text-xs"
            onClick={() => onRsvp(event.id)}
          >
            RSVP
          </Button>
        )
      )}
    </div>
  );
};
