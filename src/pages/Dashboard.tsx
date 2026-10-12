import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { useCurrentWeekMessage } from '../hooks/useWeeklyMessages';
import { useHabits } from '../hooks/useHabits';
import { useDevotional } from '../hooks/useDevotional';
import { useHomeLayout, type HomeSectionId } from '../hooks/useHomeLayout';
import { getUpcomingEvents } from '../lib/queries';
import { cn } from '../lib/utils';
import { Button } from '../components/foundation/Button';
import { MinistryPulse } from '../components/dashboard/MinistryPulse';
import { NeedsAttention } from '../components/dashboard/NeedsAttention';
import { UpcomingSection } from '../components/dashboard/UpcomingSection';
import { OutreachSnapshot } from '../components/dashboard/OutreachSnapshot';
import { GrowthSnapshot } from '../components/dashboard/GrowthSnapshot';
import type { Event } from '../types';
import type { AuthUser } from '../lib/auth';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

const SECTION_LABELS: Record<HomeSectionId, string> = {
  needsAttention: 'Needs Attention',
  upcoming: 'Upcoming',
  growth: 'Growth Snapshot',
  outreach: 'Outreach Snapshot',
};

// Sections that take two of the three desktop columns; the others take one.
const WIDE_SECTIONS: HomeSectionId[] = ['needsAttention', 'upcoming'];

interface DashboardProps {
  user: AuthUser | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ user }) => {
  const navigate = useNavigate();
  const { stats, meetings, attentionContacts, loading, error } = useDashboardStats(user);
  const { message } = useCurrentWeekMessage();
  const { habitsWithStats } = useHabits(user?.id);
  const devotional = useDevotional();
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    getUpcomingEvents(6).then(setEvents).catch(console.error);
  }, []);

  const role = user?.role ?? 'member';
  const level = ROLE_LEVEL[role] ?? 0;
  const isLeader = level >= 1;
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const today = format(new Date(), 'EEEE, MMMM d');

  const habitsDone = habitsWithStats.filter((h) => h.today_status === 'done').length;
  const habitsTotal = habitsWithStats.length;
  const devotionalViewed = !!devotional.view;

  const { order, move, reset: resetLayout } = useHomeLayout(user?.id);
  const [customizing, setCustomizing] = useState(false);

  // Needs Attention and Outreach are leaders-only; members see Upcoming and Growth.
  const visibleSections = order.filter((id) => isLeader || (id !== 'needsAttention' && id !== 'outreach'));

  function renderSection(id: HomeSectionId) {
    switch (id) {
      case 'needsAttention':
        return <NeedsAttention contacts={attentionContacts} loading={loading} />;
      case 'upcoming':
        return <UpcomingSection events={events} meetings={meetings} loading={loading} />;
      case 'growth':
        return (
          <GrowthSnapshot
            habitsDone={habitsDone}
            habitsTotal={habitsTotal}
            devotionalViewed={devotionalViewed}
            weeklyMessageTitle={message?.title}
            role={role}
            loading={loading}
          />
        );
      case 'outreach':
        return <OutreachSnapshot stats={stats} attentionContacts={attentionContacts} loading={loading} />;
    }
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Welcome Header */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg shadow-sm overflow-hidden">
        <div className="border-t-[3px] border-york-600 px-5 py-4">
          <p className="text-xs text-gray-400 dark:text-slate-500 font-medium">{today}</p>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100 mt-0.5">
            Good to see you, {firstName}.
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            {loading
              ? 'Loading your ministry snapshot…'
              : isLeader
              ? "Here's what needs your attention today."
              : 'Your ministry, meetings, and growth at a glance.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-york-200 bg-york-50 dark:bg-york-900/20 dark:border-york-800 p-3.5 text-sm text-york-700 dark:text-york-300">
          {error}
        </div>
      )}

      {/* Ministry Pulse */}
      <MinistryPulse
        stats={stats}
        attentionCount={attentionContacts.length}
        role={role}
        loading={loading}
        onNavigate={navigate}
      />

      {/* Customizable sections */}
      <div className="flex items-center justify-end gap-2">
        {customizing && (
          <Button variant="ghost" onClick={resetLayout}>
            Reset order
          </Button>
        )}
        <Button variant="secondary" onClick={() => setCustomizing((on) => !on)}>
          {customizing ? 'Done' : 'Customize layout'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:[grid-auto-flow:dense]">
        {visibleSections.map((id, index) => (
          <div key={id} className={cn('min-w-0', WIDE_SECTIONS.includes(id) && 'lg:col-span-2')}>
            {customizing && (
              <div className="mb-2 flex items-center justify-between rounded-md border border-dashed border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <span className="font-semibold">{SECTION_LABELS[id]}</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(id, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${SECTION_LABELS[id]} up`}
                    className="rounded px-2 py-0.5 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-slate-700"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(id, 1)}
                    disabled={index === visibleSections.length - 1}
                    aria-label={`Move ${SECTION_LABELS[id]} down`}
                    className="rounded px-2 py-0.5 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-slate-700"
                  >
                    ↓
                  </button>
                </span>
              </div>
            )}
            {renderSection(id)}
          </div>
        ))}
      </div>
    </div>
  );
};
