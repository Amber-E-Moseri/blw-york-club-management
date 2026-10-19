import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  getAllPages,
  getDevotionalByDay,
  getDevotionalByMonth,
  getEngagementStats,
  getMonthlyDevotional,
  getViewForDay,
  logView,
  markAsRead as markAsReadQuery,
} from '../lib/queries/devotionals';
import type {
  DevotionalDailyPage,
  DevotionalEngagementStats,
  DevotionalView,
  MonthlyDevotional,
} from '../types';

interface DailyState {
  devotional: MonthlyDevotional | null;
  page: DevotionalDailyPage | null;
  view: DevotionalView | null;
  stats: DevotionalEngagementStats | null;
  loading: boolean;
  error: string | null;
  markAsRead: () => Promise<void>;
  marking: boolean;
  /** Set when the last Mark as read attempt failed. Cleared on the next attempt. */
  markError: string | null;
}

interface MonthState {
  devotional: MonthlyDevotional | null;
  allDays: DevotionalDailyPage[];
  loading: boolean;
  error: string | null;
}

function currentParts() {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    day: now.getDate(),
    year: now.getFullYear(),
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not load devotional.';
}

export function useDevotional(): DailyState {
  const today = useMemo(() => currentParts(), []);
  // shouldLogView=false: completion is recorded only via the explicit "Mark as Read" button.
  return useDevotionalByDay(today.month, today.day, today.year, false);
}

export function useDevotionalByDay(
  month: number,
  day: number,
  year?: number,
  shouldLogView = false
): DailyState {
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  // Ref guard so a second tap before React re-renders cannot start a second write.
  const markInFlight = useRef(false);
  const [state, setState] = useState<Omit<DailyState, 'markAsRead' | 'marking' | 'markError'>>({
    devotional: null,
    page: null,
    view: null,
    stats: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const result = await getDevotionalByDay(month, day, year);
        if (!mounted) return;

        if (!result) {
          setState({
            devotional: null,
            page: null,
            view: null,
            stats: null,
            loading: false,
            error: null,
          });
          return;
        }

        let view: DevotionalView | null = null;
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;

        if (userId) {
          view = shouldLogView
            ? await logView(userId, result.devotional.id, result.page.day_of_month)
            : await getViewForDay(userId, result.devotional.id, result.page.day_of_month);
        }

        const stats = await getEngagementStats(result.devotional.id, result.page.day_of_month);

        if (mounted) {
          setState({
            devotional: result.devotional,
            page: result.page,
            view,
            stats,
            loading: false,
            error: null,
          });
        }
      } catch (error) {
        if (mounted) {
          setState((s) => ({
            ...s,
            loading: false,
            error: messageFromError(error),
          }));
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [month, day, year, shouldLogView]);

  const markAsRead = useCallback(async () => {
    if (markInFlight.current) return;
    markInFlight.current = true;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId || !state.devotional || !state.page) return;
      setMarking(true);
      setMarkError(null);
      try {
        // Success is only shown once the database has returned the stored view.
        const view = await markAsReadQuery(userId, state.devotional.id, state.page.day_of_month);
        setState((s) => ({ ...s, view }));
      } catch {
        setMarkError("Couldn't save your reading. Check your connection and try again.");
      } finally {
        setMarking(false);
      }
    } finally {
      markInFlight.current = false;
    }
  }, [state.devotional, state.page]);

  return { ...state, markAsRead, marking, markError };
}

export function useDevotionalByMonth(month: number, year?: number): MonthState {
  const [state, setState] = useState<MonthState>({
    devotional: null,
    allDays: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const result = await getDevotionalByMonth(month, year);
        if (!mounted) return;
        setState({
          devotional: result?.devotional ?? null,
          allDays: result?.allDays ?? [],
          loading: false,
          error: null,
        });
      } catch (error) {
        if (mounted) setState((s) => ({ ...s, loading: false, error: messageFromError(error) }));
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [month, year]);

  return state;
}

export function useMonthlyDevotional(month: number, year?: number) {
  const [devotional, setDevotional] = useState<MonthlyDevotional | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    getMonthlyDevotional(month, year)
      .then((row) => {
        if (mounted) setDevotional(row);
      })
      .catch((err) => {
        if (mounted) setError(messageFromError(err));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [month, year]);

  return { devotional, loading, error };
}

export function useDevotionalPages(devotionalId: string | undefined) {
  const [allDays, setAllDays] = useState<DevotionalDailyPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!devotionalId) return;
    let mounted = true;
    setLoading(true);
    setError(null);

    getAllPages(devotionalId)
      .then((rows) => {
        if (mounted) setAllDays(rows);
      })
      .catch((err) => {
        if (mounted) setError(messageFromError(err));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [devotionalId]);

  return { allDays, loading, error };
}
