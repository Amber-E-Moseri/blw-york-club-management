import { useState, useEffect, useCallback } from 'react';
import {
  fetchHabitTemplates,
  fetchAllHabitTemplates,
  fetchHabitEntries,
  upsertHabitEntry,
  deleteHabitEntry,
  createHabitTemplate,
  updateHabitTemplate,
  deleteHabitTemplate,
  fetchHabitAnalytics,
} from '../lib/queries/habits';
import type {
  HabitTemplate,
  HabitEntry,
  HabitWithStats,
  HabitTemplateInput,
  HabitMemberAnalytics,
} from '../types';
import { shiftDateKey, toLocalDateKey } from '../lib/dates';

function weekdayOf(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function computeStreak(
  entries: HabitEntry[],
  templateId: string,
  targetDays: number[] | null,
): number {
  const today = toLocalDateKey();
  const byDate = new Map(
    entries
      .filter((e) => e.template_id === templateId)
      .map((e) => [e.entry_date, e.status] as const),
  );

  let streak = 0;
  for (let i = 0; i <= 90; i++) {
    const dateKey = shiftDateKey(today, -i);
    const isTarget = targetDays === null || targetDays.includes(weekdayOf(dateKey));
    if (!isTarget) continue;

    const status = byDate.get(dateKey);
    if (status === 'done') {
      streak++;
    } else if (status === 'skipped') {
      // skipped = excused, doesn't break streak
    } else if (i === 0) {
      // today not yet logged — skip without breaking
    } else {
      break;
    }
  }
  return streak;
}

function computeRate7d(
  entries: HabitEntry[],
  templateId: string,
  targetDays: number[] | null,
): number {
  const today = toLocalDateKey();
  const byDate = new Map(
    entries
      .filter((e) => e.template_id === templateId)
      .map((e) => [e.entry_date, e.status] as const),
  );
  let target = 0;
  let done = 0;
  for (let i = 1; i <= 7; i++) {
    const dateKey = shiftDateKey(today, -i);
    if (targetDays !== null && !targetDays.includes(weekdayOf(dateKey))) continue;
    target++;
    if (byDate.get(dateKey) === 'done') done++;
  }
  return target > 0 ? done / target : 0;
}

export function useHabits(userId: string | undefined) {
  const [templates, setTemplates] = useState<HabitTemplate[]>([]);
  const [entries, setEntries] = useState<HabitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const dateTo = toLocalDateKey();
      const dateFrom = shiftDateKey(dateTo, -90);
      const [t, e] = await Promise.all([
        fetchHabitTemplates(),
        fetchHabitEntries(userId, dateFrom, dateTo),
      ]);
      setTemplates(t);
      setEntries(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load habits.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const habitsWithStats: HabitWithStats[] = templates.map((t) => {
    const todayStr = toLocalDateKey();
    const todayEntry = entries.find(
      (e) => e.template_id === t.id && e.entry_date === todayStr,
    );

    const past14: Record<string, 'done' | 'skipped' | undefined> = {};
    for (let i = 0; i < 14; i++) {
      const ds = shiftDateKey(todayStr, -i);
      const found = entries.find((e) => e.template_id === t.id && e.entry_date === ds);
      past14[ds] = found?.status;
    }

    return {
      template: t,
      entries: past14,
      streak: computeStreak(entries, t.id, t.target_days),
      completion_rate_7d: computeRate7d(entries, t.id, t.target_days),
      today_status: todayEntry?.status ?? 'pending',
    };
  });

  const checkIn = useCallback(
    async (templateId: string, status: 'done' | 'skipped') => {
      if (!userId) return;
      const todayStr = toLocalDateKey();
      const existing = entries.find(
        (e) => e.template_id === templateId && e.entry_date === todayStr,
      );

      if (existing?.status === status) {
        // Toggle off
        setEntries((prev) =>
          prev.filter(
            (e) => !(e.template_id === templateId && e.entry_date === todayStr),
          ),
        );
        try {
          await deleteHabitEntry(userId, templateId, todayStr);
        } catch {
          load();
        }
      } else {
        const optimistic: HabitEntry = {
          id: 'temp',
          template_id: templateId,
          user_id: userId,
          entry_date: todayStr,
          status,
          created_at: new Date().toISOString(),
        };
        setEntries((prev) => [
          ...prev.filter(
            (e) => !(e.template_id === templateId && e.entry_date === todayStr),
          ),
          optimistic,
        ]);
        try {
          const saved = await upsertHabitEntry(userId, templateId, todayStr, status);
          setEntries((prev) =>
            prev.map((e) => (e.id === 'temp' ? saved : e)),
          );
        } catch {
          load();
        }
      }
    },
    [userId, entries, load],
  );

  return { habitsWithStats, loading, error, checkIn, reload: load };
}

export function useHabitAdmin() {
  const [templates, setTemplates] = useState<HabitTemplate[]>([]);
  const [analytics, setAnalytics] = useState<HabitMemberAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchAllHabitTemplates()
      .then((t) => { if (mounted) setTemplates(t); })
      .catch((e: Error) => { if (mounted) setError(e.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const a = await fetchHabitAnalytics();
      setAnalytics(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analytics failed.');
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const saveTemplate = useCallback(
    async (input: HabitTemplateInput, userId: string, id?: string) => {
      setSaving(true);
      setError(null);
      try {
        if (id) {
          const updated = await updateHabitTemplate(id, input);
          setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
        } else {
          const created = await createHabitTemplate(input, userId);
          setTemplates((prev) => [...prev, created]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const removeTemplate = useCallback(async (id: string) => {
    setSaving(true);
    try {
      await deleteHabitTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setSaving(false);
    }
  }, []);

  const toggleActive = useCallback(async (id: string, is_active: boolean) => {
    const updated = await updateHabitTemplate(id, { is_active });
    setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
  }, []);

  return {
    templates, analytics, loading, analyticsLoading, error, saving,
    saveTemplate, removeTemplate, toggleActive, loadAnalytics,
  };
}
