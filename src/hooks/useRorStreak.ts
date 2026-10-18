import { useEffect, useState } from 'react';
import { fetchCellRorProgress, fetchMemberReadDates, fetchOrgRorProgress, fetchRorStreak } from '../lib/queries/rorStreaks';
import type { CellMemberRorRow, RorStreak } from '../lib/queries/rorStreaks';

interface StreakState {
  streak: RorStreak | null;
  readDates: string[];
  loading: boolean;
  error: string | null;
}

export function useRorStreak(memberId: string | undefined, devotionalId?: string): StreakState {
  const [state, setState] = useState<StreakState>({
    streak: null, readDates: [], loading: !!memberId, error: null,
  });

  useEffect(() => {
    if (!memberId) {
      setState({ streak: null, readDates: [], loading: false, error: null });
      return;
    }
    let mounted = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    async function load() {
      try {
        const [streak, readDates] = await Promise.all([
          fetchRorStreak(memberId!),
          devotionalId ? fetchMemberReadDates(memberId!, devotionalId) : Promise.resolve([]),
        ]);
        if (mounted) setState({ streak, readDates, loading: false, error: null });
      } catch (err) {
        if (mounted) setState((s) => ({
          ...s, loading: false,
          error: err instanceof Error ? err.message : 'Could not load streak.',
        }));
      }
    }

    load();
    return () => { mounted = false; };
  }, [memberId, devotionalId]);

  return state;
}

interface CellProgressState {
  rows: CellMemberRorRow[];
  loading: boolean;
  error: string | null;
}

export function useCellRorProgress(): CellProgressState {
  const [state, setState] = useState<CellProgressState>({ rows: [], loading: true, error: null });

  useEffect(() => {
    let mounted = true;
    fetchCellRorProgress()
      .then((rows) => { if (mounted) setState({ rows, loading: false, error: null }); })
      .catch((err) => {
        if (mounted) setState({ rows: [], loading: false,
          error: err instanceof Error ? err.message : 'Could not load progress.' });
      });
    return () => { mounted = false; };
  }, []);

  return state;
}

interface OrgProgressState {
  rows: CellMemberRorRow[];
  loading: boolean;
  error: string | null;
}

export function useOrgRorProgress(): OrgProgressState {
  const [state, setState] = useState<OrgProgressState>({ rows: [], loading: true, error: null });

  useEffect(() => {
    let mounted = true;
    fetchOrgRorProgress()
      .then((rows) => { if (mounted) setState({ rows, loading: false, error: null }); })
      .catch((err) => {
        if (mounted) setState({ rows: [], loading: false,
          error: err instanceof Error ? err.message : 'Could not load progress.' });
      });
    return () => { mounted = false; };
  }, []);

  return state;
}
