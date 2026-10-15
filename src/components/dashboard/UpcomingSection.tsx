import React from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { DashboardCard, Skeleton } from './DashboardCard';
import type { Event, Meeting } from '../../types';

interface UpcomingItem {
  id: string;
  type: 'event' | 'meeting';
  title: string;
  date: string;
  time?: string;
  location?: string;
  category?: string;
  href: string;
}

function mergeAndSort(events: Event[], meetings: Meeting[]): UpcomingItem[] {
  const eventItems: UpcomingItem[] = events.map((e) => ({
    id: `ev-${e.id}`,
    type: 'event',
    title: e.title,
    date: e.date,
    time: e.time,
    location: e.location,
    category: e.category,
    href: '/events',
  }));

  const meetingItems: UpcomingItem[] = meetings.map((m) => ({
    id: `mt-${m.id}`,
    type: 'meeting',
    title: m.title,
    date: m.date,
    time: m.time,
    location: m.location,
    category: m.category,
    href: '/meetings',
  }));

  return [...eventItems, ...meetingItems]
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return (a.time ?? '').localeCompare(b.time ?? '');
    })
    .slice(0, 6);
}

const CATEGORY_COLORS: Record<string, string> = {
  cell: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  general: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
  bsc: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  leadership: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'Bible Study': 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Worship: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  Fellowship: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Outreach: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  Prayer: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

function categoryColor(cat?: string) {
  return cat ? (CATEGORY_COLORS[cat] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300') : 'bg-gray-100 text-gray-600';
}

function formatItemDate(dateStr: string) {
  try {
    const d = parseISO(dateStr);
    return { month: format(d, 'MMM').toUpperCase(), day: format(d, 'd') };
  } catch {
    return { month: '—', day: '—' };
  }
}

interface UpcomingSectionProps {
  events: Event[];
  meetings: Meeting[];
  loading: boolean;
}

export const UpcomingSection: React.FC<UpcomingSectionProps> = ({ events, meetings, loading }) => {
  const navigate = useNavigate();
  const items = mergeAndSort(events, meetings);

  return (
    <DashboardCard
      title="Upcoming"
      action={{ label: 'View calendar', onClick: () => navigate('/events') }}
      noPadding
    >
      {loading ? (
        <div className="px-5 py-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm font-semibold text-gray-600 dark:text-slate-300">Nothing coming up yet</p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Check back soon for events and meetings.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {items.map((item) => {
            const { month, day } = formatItemDate(item.date);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => navigate(item.href)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-york-50 dark:bg-york-900/20 flex flex-col items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold text-york-600 dark:text-york-400 uppercase">{month}</span>
                    <span className="text-lg font-bold text-york-600 dark:text-york-400 leading-tight">{day}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">{item.title}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                      {item.time}{item.location ? ` · ${item.location}` : ''}
                    </p>
                  </div>
                  {item.category && (
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${categoryColor(item.category)}`}>
                      {item.category}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
};
