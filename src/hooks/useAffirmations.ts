import { useState, useEffect, useCallback } from 'react';
import type { Affirmation } from '../types';
import {
  fetchUpcomingAffirmations,
  fetchAffirmationsForDate,
  createAffirmation,
  deleteAffirmation,
  declareAffirmation,
  undeclareAffirmation,
} from '../lib/queries/affirmations';

export function useAffirmations(date?: string) {
  const [affirmations, setAffirmations] = useState<Affirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = date
        ? await fetchAffirmationsForDate(date)
        : await fetchUpcomingAffirmations(7);
      setAffirmations(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load affirmations.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const declare = useCallback(async (affirmationId: string, userId: string) => {
    await declareAffirmation(affirmationId, userId);
    setAffirmations((prev) =>
      prev.map((c) =>
        c.id === affirmationId
          ? { ...c, declared_by_me: true, declaration_count: (c.declaration_count ?? 0) + 1 }
          : c
      )
    );
  }, []);

  const undeclare = useCallback(async (affirmationId: string, userId: string) => {
    await undeclareAffirmation(affirmationId, userId);
    setAffirmations((prev) =>
      prev.map((c) =>
        c.id === affirmationId
          ? { ...c, declared_by_me: false, declaration_count: Math.max(0, (c.declaration_count ?? 1) - 1) }
          : c
      )
    );
  }, []);

  const add = useCallback(async (input: {
    title: string; body: string; scheduled_date: string; created_by: string;
  }) => {
    await createAffirmation(input);
    await load();
  }, [load]);

  const remove = useCallback(async (id: string) => {
    await deleteAffirmation(id);
    setAffirmations((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { affirmations, loading, error, refetch: load, declare, undeclare, add, remove };
}
