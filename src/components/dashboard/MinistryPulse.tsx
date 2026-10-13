import React from 'react';
import { Users, ClipboardList, AlertCircle, Calendar } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { EnhancedDashboardStats } from '../../types';
import type { AuthUser } from '../../lib/auth';
import { Skeleton } from './DashboardCard';
import { useCountUp } from '../../hooks/useCountUp';

/** Counts numeric metrics up on mount; text metrics render as-is. */
const MetricValue: React.FC<{ value: number | string }> = ({ value }) => {
  const counted = useCountUp(typeof value === 'number' ? value : NaN);
  return <>{typeof value === 'number' ? counted : value}</>;
};

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

interface PulseMetric {
  label: string;
  value: number | string;
  sub: string;
  icon: React.FC<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  onClick?: () => void;
  urgent?: boolean;
}

interface MinistryPulseProps {
  stats: EnhancedDashboardStats | null;
  attentionCount: number;
  role: AuthUser['role'];
  loading: boolean;
  onNavigate: (path: string) => void;
}

export const MinistryPulse: React.FC<MinistryPulseProps> = ({
  stats, attentionCount, role, loading, onNavigate,
}) => {
  const level = ROLE_LEVEL[role] ?? 0;

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: level >= 1 ? 4 : 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
    );
  }

  const leaderMetrics: PulseMetric[] = [
    {
      label: 'Members',
      value: stats?.member_count ?? 0,
      sub: stats?.member_growth ? `+${stats.member_growth} this month` : 'Total registered',
      icon: Users,
      iconBg: 'bg-blue-50 dark:bg-blue-900/20',
      iconColor: 'text-blue-600',
      onClick: () => onNavigate('/members'),
    },
    {
      label: 'Outreach contacts',
      value: stats?.contacts_this_week ?? 0,
      sub: 'Logged this week',
      icon: ClipboardList,
      iconBg: 'bg-green-50 dark:bg-green-900/20',
      iconColor: 'text-green-600',
      onClick: () => onNavigate('/contacts'),
    },
    {
      label: 'Needs follow-up',
      value: attentionCount,
      sub: attentionCount === 0 ? 'You\'re caught up' : 'Awaiting action',
      icon: AlertCircle,
      iconBg: attentionCount > 0 ? 'bg-york-50 dark:bg-york-900/20' : 'bg-gray-50 dark:bg-slate-700',
      iconColor: attentionCount > 0 ? 'text-york-600 dark:text-york-400' : 'text-gray-400 dark:text-slate-400',
      onClick: () => onNavigate('/contacts'),
      urgent: attentionCount > 0,
    },
    {
      label: 'Meetings',
      value: stats?.meetings_this_month ?? 0,
      sub: 'This month',
      icon: Calendar,
      iconBg: 'bg-purple-50 dark:bg-purple-900/20',
      iconColor: 'text-purple-600',
      onClick: () => onNavigate('/meetings'),
    },
  ];

  const memberMetrics: PulseMetric[] = [
    {
      label: 'Meetings',
      value: stats?.meetings_this_month ?? 0,
      sub: 'This month',
      icon: Calendar,
      iconBg: 'bg-purple-50 dark:bg-purple-900/20',
      iconColor: 'text-purple-600',
      onClick: () => onNavigate('/meetings'),
    },
    {
      label: 'Habit completion',
      value: stats?.habit_streak_avg ? `${stats.habit_streak_avg}%` : '—',
      sub: '7-day average',
      icon: ({ className }) => (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
      ),
      iconBg: 'bg-green-50 dark:bg-green-900/20',
      iconColor: 'text-green-600',
      onClick: () => onNavigate('/habits'),
    },
  ];

  const metrics = level >= 1 ? leaderMetrics : memberMetrics;

  return (
    <div className={cn('grid grid-cols-2 gap-3', level >= 1 ? 'xl:grid-cols-4' : 'sm:grid-cols-2 max-w-sm')}>
      {metrics.map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.label}
            type="button"
            onClick={m.onClick}
            className={cn(
              'text-left bg-white dark:bg-slate-900 border rounded-lg shadow-sm p-3.5 transition-all duration-150',
              'hover:shadow-md active:scale-[0.99]',
              m.urgent
                ? 'border-york-200 dark:border-york-800'
                : 'border-gray-200 dark:border-slate-800',
            )}
          >
            <div className={cn('w-8 h-8 rounded-md flex items-center justify-center mb-2.5', m.iconBg)}>
              <Icon className={cn('w-4 h-4', m.iconColor)} />
            </div>
            <p className="text-xl font-bold text-gray-900 dark:text-white leading-none">
              <MetricValue value={m.value} />
            </p>
            <p className="text-[11px] font-semibold text-gray-400 dark:text-slate-400 mt-0.5 uppercase tracking-wider">
              {m.label}
            </p>
            <p className={cn('text-xs mt-1', m.urgent ? 'text-york-600 dark:text-york-400 font-medium' : 'text-gray-400 dark:text-slate-400')}>
              {m.sub}
            </p>
          </button>
        );
      })}
    </div>
  );
};
