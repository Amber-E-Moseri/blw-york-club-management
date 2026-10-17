import { useState, useEffect, useCallback } from 'react';
import type { Affirmation as Confession } from '../types';
import {
  fetchUpcomingConfessions,
  fetchConfessionsForDate,
  createConfession,
  deleteConfession,
  declareConfession,
  undeclareConfession,
} from '../lib/queries/confessions';

export function useConfessions(date?: string) {
  const [confessions, setConfessions] = useState<Confession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = date
        ? await fetchConfessionsForDate(date)
        : await fetchUpcomingConfessions(7);
      setConfessions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load confessions.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const declare = useCallback(async (confessionId: string, userId: string) => {
    await declareConfession(confessionId, userId);
    setConfessions((prev) =>
      prev.map((c) =>
        c.id === confessionId
          ? { ...c, declared_by_me: true, declaration_count: (c.declaration_count ?? 0) + 1 }
          : c
      )
    );
  }, []);

  const undeclare = useCallback(async (confessionId: string, userId: string) => {
    await undeclareConfession(confessionId, userId);
    setConfessions((prev) =>
      prev.map((c) =>
        c.id === confessionId
          ? { ...c, declared_by_me: false, declaration_count: Math.max(0, (c.declaration_count ?? 1) - 1) }
          : c
      )
    );
  }, []);

  const add = useCallback(async (input: {
    title: string; body: string; scheduled_date: string; created_by: string;
  }) => {
    await createConfession(input);
    await load();
  }, [load]);

  const remove = useCallback(async (id: string) => {
    await deleteConfession(id);
    setConfessions((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { confessions, loading, error, refetch: load, declare, undeclare, add, remove };
}
