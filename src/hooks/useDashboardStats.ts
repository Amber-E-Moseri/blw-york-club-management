import { useCallback, useEffect, useState } from 'react';
import type { ActivityItem, EnhancedDashboardStats, Meeting } from '../types';
import type { AuthUser } from '../lib/auth';
import {
  getEnhancedDashboardStats,
  getRecentActivity,
  getUpcomingMeetings,
  getContactsNeedingAttention,
  type AttentionContact,
} from '../lib/queries/dashboardStats';

export type { AttentionContact };

export function useDashboardStats(user: AuthUser | null) {
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

    setLoading(true);
    setError(null);
    try {
      const [nextStats, nextActivity, nextMeetings, nextAttention] = await Promise.all([
        getEnhancedDashboardStats(user.id, user.role, user.cellId),
        getRecentActivity(user.id, user.role),
        getUpcomingMeetings(user.id, user.cellId),
        getContactsNeedingAttention(user.role, user.id, user.cellId),
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
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return { stats, activity, meetings, attentionContacts, loading, error, reload: load };
}
