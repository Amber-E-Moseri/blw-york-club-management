import { supabase } from '../supabase';
import { rorMonthYear, rorToday } from '../rorDates';

export interface RorStreak {
  current_streak: number;
  longest_streak: number;
  monthly_completed: number;
  monthly_total: number;
  last_completed: string | null;
}

export interface CellMemberRorRow {
  member_key: string;
  /** The auth user id. Present for staff only; null for a cell leader. */
  member_id: string | null;
  full_name: string;
  cell_id: string;
  cell_name: string;
  current_streak: number;
  longest_streak: number;
  monthly_completed: number;
  monthly_total: number;
  last_completed: string | null;
}

// Reporting dates are the Toronto calendar day (src/lib/rorDates.ts), not the UTC day or the browser's local day.
const todayIso = (): string => rorToday();
const monthYearIso = (): string => rorMonthYear();

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

/**
 * Reading dates for one member of a cell the caller leads, by member key (migration 071). Returns only the dates; an
 * unknown or unauthorised key returns no dates.
 */
export async function fetchCellMemberReadDates(memberKey: string, devotionalId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_cell_member_read_dates', {
    p_member_key: memberKey,
    p_devotional_id: devotionalId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ viewed_date: string }>).map((r) => r.viewed_date);
}
