import { supabase } from '../supabase';
import type { WeeklyMessage, WeeklyMessageInput } from '../../types';

function toDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function getMondayOfWeek(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekBounds(date: Date = new Date()): { start: string; end: string } {
  const monday = getMondayOfWeek(date);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: toDate(monday), end: toDate(sunday) };
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return toDate(d);
}

export async function fetchCurrentWeekOrgMessage(): Promise<WeeklyMessage | null> {
  const today = toDate(new Date());
  const { data, error } = await supabase
    .from('weekly_messages')
    .select('*')
    .eq('scope', 'org')
    .lte('week_start', today)
    .gte('week_end', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchMonthMessages(
  year: number,
  month: number,
  userId?: string,
): Promise<WeeklyMessage[]> {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  let query = supabase
    .from('weekly_messages')
    .select('*')
    .lte('week_start', monthEnd)
    .gte('week_end', monthStart)
    .order('week_start');

  if (userId) {
    query = query.or(`scope.eq.org,created_by.eq.${userId}`);
  } else {
    query = query.eq('scope', 'org');
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchWeekMessages(
  weekStart: string,
  userId?: string,
): Promise<WeeklyMessage[]> {
  const weekEnd = addDays(weekStart, 6);
  let query = supabase
    .from('weekly_messages')
    .select('*')
    .lte('week_start', weekEnd)
    .gte('week_end', weekStart)
    .order('scope');

  if (userId) {
    query = query.or(`scope.eq.org,created_by.eq.${userId}`);
  } else {
    query = query.eq('scope', 'org');
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createWeeklyMessage(
  input: WeeklyMessageInput,
  userId: string,
  authorName: string,
): Promise<WeeklyMessage[]> {
  const baseRow = {
    ...input,
    audience_type: input.audience_type ?? 'org',
    audience_id: input.audience_id ?? null,
    created_by: userId,
    author_name: authorName,
  };
  const rows: typeof baseRow[] = [baseRow];

  if (input.is_recurring && input.recurrence_weeks > 1) {
    const intervalDays = input.recurrence_type === 'biweekly' ? 14 : 7;
    for (let i = 1; i < input.recurrence_weeks; i++) {
      const offset = i * intervalDays;
      rows.push({
        ...baseRow,
        week_start: addDays(input.week_start, offset),
        week_end: addDays(input.week_end, offset),
        is_recurring: false,
        recurrence_weeks: 1,
        recurrence_type: 'none',
      });
    }
  }

  const { data, error } = await supabase
    .from('weekly_messages')
    .insert(rows)
    .select();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function updateWeeklyMessage(
  id: string,
  input: Partial<WeeklyMessageInput>,
): Promise<WeeklyMessage> {
  const { data, error } = await supabase
    .from('weekly_messages')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteWeeklyMessage(id: string): Promise<void> {
  const { error } = await supabase.from('weekly_messages').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
