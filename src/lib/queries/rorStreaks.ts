import { supabase } from '../supabase';

export interface RorStreak {
  current_streak: number;
  longest_streak: number;
  monthly_completed: number;
  monthly_total: number;
  last_completed: string | null;
}

export interface CellMemberRorRow {
  member_id: string;
  full_name: string;
  cell_id: string;
  cell_name: string;
  current_streak: number;
  longest_streak: number;
  monthly_completed: number;
  monthly_total: number;
  last_completed: string | null;
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function monthYearIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function fetchRorStreak(
  memberId: string,
  today = todayIso(),
  monthYear = monthYearIso()
): Promise<RorStreak> {
  const { data, error } = await supabase.rpc('get_ror_streak', {
    p_member_id:  memberId,
    p_today:      today,
    p_month_year: monthYear,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    current_streak:    row?.current_streak    ?? 0,
    longest_streak:    row?.longest_streak    ?? 0,
    monthly_completed: row?.monthly_completed ?? 0,
    monthly_total:     row?.monthly_total     ?? 0,
    last_completed:    row?.last_completed    ?? null,
  };
}

export async function fetchCellRorProgress(
  today = todayIso(),
  monthYear = monthYearIso()
): Promise<CellMemberRorRow[]> {
  const { data, error } = await supabase.rpc('get_cell_ror_progress', {
    p_today:      today,
    p_month_year: monthYear,
  });
  if (error) throw new Error(error.message);
  return (data as CellMemberRorRow[]) ?? [];
}

export async function fetchOrgRorProgress(
  today = todayIso(),
  monthYear = monthYearIso()
): Promise<CellMemberRorRow[]> {
  const { data, error } = await supabase.rpc('get_org_ror_progress', {
    p_today:      today,
    p_month_year: monthYear,
  });
  if (error) throw new Error(error.message);
  return (data as CellMemberRorRow[]) ?? [];
}

/** All viewed_dates for the member in the given devotional (for the calendar). */
export async function fetchMemberReadDates(
  memberId: string,
  devotionalId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('devotional_views')
    .select('viewed_date, day_of_month')
    .eq('member_id', memberId)
    .eq('devotional_id', devotionalId)
    .order('day_of_month', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.viewed_date as string);
}
