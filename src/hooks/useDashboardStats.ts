import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActivityItem, EnhancedDashboardStats, Meeting } from '../types';
import type { AuthUser } from '../lib/auth';
import type { LeadershipScope } from '../lib/leadership';
import { useLeadership } from './useLeadership';
import {
  getEnhancedDashboardStats,
  getRecentActivity,
  getUpcomingMeetings,
  getContactsNeedingAttention,
  type AttentionContact,
} from '../lib/queries/dashboardStats';

export type { AttentionContact };

export function useDashboardStats(user: AuthUser | null) {
  const { isStaff, ledCells, loading: leadershipLoading } = useLeadership();
  // Data scope comes from the same capability as navigation and routes. It reloads when leadership changes.
  const scope = useMemo<LeadershipScope>(
    () => ({ isStaff, ledCellIds: ledCells.map((cell) => cell.id) }),
    [isStaff, ledCells]
  );
  const [stats, setStats] = useState<EnhancedDashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [attentionContacts, setAttentionContacts] = useState<AttentionContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    // Wait for the assignment lookup, so the first load is never shown with the wrong scope.
    if (leadershipLoading) return;

    setLoading(true);
    setError(null);
    try {
      const [nextStats, nextActivity, nextMeetings, nextAttention] = await Promise.all([
        getEnhancedDashboardStats(user.id, scope),
        getRecentActivity(user.id, scope),
        getUpcomingMeetings(user.id, user.cellId),
        getContactsNeedingAttention(scope),
      ]);
      setStats(nextStats);
      setActivity(nextActivity);
      setMeetings(nextMeetings);
      setAttentionContacts(nextAttention);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dashboard.');
    } finally {
      setLoading(false);
    }
  }, [user, scope, leadershipLoading]);

  useEffect(() => {
    load();
  }, [load]);

  return { stats, activity, meetings, attentionContacts, loading, error, reload: load };
}
