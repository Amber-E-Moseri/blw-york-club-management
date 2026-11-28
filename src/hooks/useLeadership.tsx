import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AuthUser } from '../lib/auth';
import { CLOSED_LEADERSHIP, deriveLeadership, type LedCell, type LeadershipState } from '../lib/leadership';

/**
 * Supplies the leadership capability to the Hub. Mounted once around the signed-in shell, so every navigation item,
 * route guard and page reads the same single lookup instead of checking the role on its own.
 *
 * The lookup reads `cells` where `leader_id` is the signed-in user. A failed lookup fails closed. Assignments are
 * re-read when the window regains focus, which picks up a reassignment or removal without a sign-out. Each response is
 * matched to the newest request, so an older slow response cannot overwrite a newer one.
 *
 * Results are keyed to the user they were read for. Until that user's lookup has finished, `loading` is true, so a
 * leader is never redirected away from a leader page before their assignments are known.
 */

interface LeadershipResult {
  key: string;
  cells: LedCell[];
  error: string | null;
}

const LeadershipContext = createContext<LeadershipState | null>(null);
// A stable empty list, so memoised consumers do not re-run on every render while nothing is known.
const NO_CELLS: LedCell[] = [];

interface LeadershipProviderProps {
  user: AuthUser | null;
  children: React.ReactNode;
}

export const LeadershipProvider: React.FC<LeadershipProviderProps> = ({ user, children }) => {
  const userId = user?.id ?? null;
  const active = user?.status === 'active';
  // The key is null when there is nothing to look up (signed out, or not an active account). Then nothing is granted.
  const key = userId && active ? userId : null;
  const [result, setResult] = useState<LeadershipResult | null>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    if (!key) return;
    const request = ++latestRequest.current;
    const fail = () =>
      setResult({ key, cells: [], error: 'Could not confirm your leadership access. Try again.' });
    try {
      const { data, error: queryError } = await supabase
        .from('cells')
        .select('id, name, leader_id')
        .eq('leader_id', key);
      if (request !== latestRequest.current) return;
      if (queryError) fail();
      else setResult({ key, cells: (data ?? []) as LedCell[], error: null });
    } catch {
      if (request === latestRequest.current) fail();
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!key) return undefined;
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [key, load]);

  const current = key && result && result.key === key ? result : null;
  const loading = key !== null && current === null;
  const cells = current?.cells ?? NO_CELLS;
  const error = current?.error ?? null;

  const value = useMemo<LeadershipState>(
    () => ({
      ...deriveLeadership(user, cells),
      loading,
      error,
      refresh: () => void load(),
    }),
    [user, cells, loading, error, load]
  );

  return <LeadershipContext.Provider value={value}>{children}</LeadershipContext.Provider>;
};

/**
 * The leadership capability for the current user. Outside a provider it returns the closed value, which grants nothing,
 * so a missing provider can only ever hide leader controls.
 */
export function useLeadership(): LeadershipState {
  const context = useContext(LeadershipContext);
  if (context) return context;
  return { ...CLOSED_LEADERSHIP, loading: false, error: null, refresh: () => undefined };
}
