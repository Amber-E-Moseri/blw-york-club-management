import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Users2 } from 'lucide-react';
import { DashboardCard, Skeleton } from './DashboardCard';
import type { EnhancedDashboardStats } from '../../types';
import type { AttentionContact } from '../../hooks/useDashboardStats';

interface OutreachSnapshotProps {
  stats: EnhancedDashboardStats | null;
  attentionContacts: AttentionContact[];
  loading: boolean;
}

export const OutreachSnapshot: React.FC<OutreachSnapshotProps> = ({
  stats, attentionContacts, loading,
}) => {
  const navigate = useNavigate();
  const newContacts = stats?.contacts_this_week ?? 0;
  const followUpCount = attentionContacts.length;

  return (
    <DashboardCard
      title="Outreach Snapshot"
      action={{ label: 'Open CRM', onClick: () => navigate('/contacts') }}
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <Users2 className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-sm text-gray-600 dark:text-slate-400">New contacts this week</span>
            </div>
            <span className="text-lg font-bold text-gray-900 dark:text-slate-100">{newContacts}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${followUpCount > 0 ? 'bg-york-50 dark:bg-york-900/20' : 'bg-gray-50 dark:bg-slate-700'}`}>
                <TrendingUp className={`w-4 h-4 ${followUpCount > 0 ? 'text-york-600' : 'text-gray-400'}`} />
              </div>
              <span className="text-sm text-gray-600 dark:text-slate-400">Awaiting follow-up</span>
            </div>
            <span className={`text-lg font-bold ${followUpCount > 0 ? 'text-york-600' : 'text-gray-900 dark:text-slate-100'}`}>
              {followUpCount}
            </span>
          </div>

          {stats?.contacts_last_7_days && stats.contacts_last_7_days.length > 0 && (
            <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
              <p className="text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Last 7 days</p>
              <div className="flex items-end gap-1 h-8">
                {stats.contacts_last_7_days.map((day) => {
                  const max = Math.max(...stats.contacts_last_7_days!.map((d) => d.count), 1);
                  const pct = (day.count / max) * 100;
                  return (
                    <div
                      key={day.date}
                      className="flex-1 rounded-sm bg-york-200 dark:bg-york-800 transition-all"
                      style={{ height: `${Math.max(pct, 8)}%` }}
                      title={`${day.date}: ${day.count}`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
};
