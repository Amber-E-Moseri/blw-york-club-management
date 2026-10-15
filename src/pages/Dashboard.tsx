import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { useCurrentWeekMessage } from '../hooks/useWeeklyMessages';
import { useHabits } from '../hooks/useHabits';
import { useDevotional } from '../hooks/useDevotional';
import { getUpcomingEvents } from '../lib/queries';
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

  return (
    <div className="space-y-5 pb-4">
      {/* Welcome Header */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-york-600 px-5 py-5">
          <p className="text-xs text-gray-400 dark:text-slate-500 font-medium">{today}</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">
            Good to see you, {firstName}.
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            {loading
              ? 'Loading your ministry snapshot…'
              : isLeader
              ? "Here's what needs your attention today."
              : 'Your ministry, meetings, and growth at a glance.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-york-200 bg-york-50 dark:bg-york-900/20 dark:border-york-800 p-4 text-sm text-york-700 dark:text-york-300">
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

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left / main column */}
        <div className="space-y-5 lg:col-span-2">
          {/* Needs Attention — leaders only */}
          {isLeader && (
            <NeedsAttention contacts={attentionContacts} loading={loading} />
          )}

          {/* Upcoming — events + meetings merged */}
          <UpcomingSection
            events={events}
            meetings={meetings}
            loading={loading}
          />
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          {/* Outreach Snapshot — leaders only */}
          {isLeader && (
            <OutreachSnapshot
              stats={stats}
              attentionContacts={attentionContacts}
              loading={loading}
            />
          )}

          {/* Growth Snapshot — all roles */}
          <GrowthSnapshot
            habitsDone={habitsDone}
            habitsTotal={habitsTotal}
            devotionalViewed={devotionalViewed}
            weeklyMessageTitle={message?.title}
            role={role}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
};
