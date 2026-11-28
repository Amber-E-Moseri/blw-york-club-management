import { useEffect, useState } from 'react';
import type { SearchResult } from '../types';
import type { AuthUser } from '../lib/auth';
import { globalSearch } from '../lib/queries/search';
import { useLeadership } from './useLeadership';

export function useSearch(query: string, user: AuthUser | null, enabled: boolean) {
  const { isStaff, ledCells } = useLeadership();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !user || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      globalSearch(query, user.id, { isStaff, ledCellIds: ledCells.map((cell) => cell.id) })
        .then(setResults)
        .catch((err) => setError(err instanceof Error ? err.message : 'Search failed.'))
        .finally(() => setLoading(false));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, user, enabled, isStaff, ledCells]);

  return { results, loading, error };
}
