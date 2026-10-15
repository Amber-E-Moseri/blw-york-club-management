import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CheckCircle } from 'lucide-react';
import { DashboardCard, Skeleton } from './DashboardCard';
import type { AuthUser } from '../../lib/auth';

interface GrowthSnapshotProps {
  habitsDone: number;
  habitsTotal: number;
  devotionalViewed: boolean;
  weeklyMessageTitle?: string;
  role: AuthUser['role'];
  loading: boolean;
}

export const GrowthSnapshot: React.FC<GrowthSnapshotProps> = ({
  habitsDone,
  habitsTotal,
  devotionalViewed,
  weeklyMessageTitle,
  role,
  loading,
}) => {
  const navigate = useNavigate();
  const habitPct = habitsTotal > 0 ? Math.round((habitsDone / habitsTotal) * 100) : 0;

  return (
    <DashboardCard
      title="Growth Snapshot"
      action={{ label: 'Go to Growth', onClick: () => navigate('/growth') }}
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate('/devotionals')}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${devotionalViewed ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-slate-700'}`}>
                <BookOpen className={`w-4 h-4 ${devotionalViewed ? 'text-emerald-600' : 'text-gray-400'}`} />
              </div>
              <span className="text-sm text-gray-600 dark:text-slate-400">Daily Bread</span>
            </div>
            {devotionalViewed ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <CheckCircle className="w-3.5 h-3.5" /> Viewed
              </span>
            ) : (
              <span className="text-xs font-semibold text-york-600 group-hover:underline">Read now</span>
            )}
          </button>

          {habitsTotal > 0 && (
            <button
              type="button"
              onClick={() => navigate('/habits')}
              className="w-full"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600 dark:text-slate-400">Habits today</span>
                <span className="text-sm font-bold text-gray-900 dark:text-slate-100">
                  {habitsDone}/{habitsTotal}
                </span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-1.5">
                <div
                  className="bg-york-600 h-1.5 rounded-full transition-all"
                  style={{ width: `${habitPct}%` }}
                />
              </div>
            </button>
          )}

          {weeklyMessageTitle && (
            <button
              type="button"
              onClick={() => navigate('/messages')}
              className="w-full flex items-center justify-between group"
            >
              <span className="text-sm text-gray-600 dark:text-slate-400 truncate text-left pr-2">
                {weeklyMessageTitle}
              </span>
              <span className="shrink-0 text-xs font-semibold text-york-600 group-hover:underline">Read</span>
            </button>
          )}
        </div>
      )}
    </DashboardCard>
  );
};
