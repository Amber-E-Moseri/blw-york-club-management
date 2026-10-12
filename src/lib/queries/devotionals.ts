import { supabase } from '../supabase';
import type {
  DevotionalDailyPage,
  DevotionalEngagementStats,
  DevotionalView,
  MonthlyDevotional,
} from '../../types';

export interface CreateDevotionalInput {
  month: number;
  year: number;
  title: string;
  book_title: string;
  author?: string | null;
  total_days: number;
  total_pages: number;
  created_by: string;
}

export interface CreateDailyPageInput {
  devotional_id: string;
  day_of_month: number;
  page_range: string;
  image_url: string;
  title?: string | null;
}

function normalizeYear(year?: number): number {
  return year ?? new Date().getFullYear();
}

export async function getMonthlyDevotional(month: number, year?: number): Promise<MonthlyDevotional | null> {
  const { data, error } = await supabase
    .from('monthly_devotionals')
    .select('*')
    .eq('month', month)
    .eq('year', normalizeYear(year))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? null;
}

export async function getDevotionalByDay(
  month: number,
  day: number,
  year?: number
): Promise<{ devotional: MonthlyDevotional; page: DevotionalDailyPage } | null> {
  const devotional = await getMonthlyDevotional(month, year);
  if (!devotional) return null;

  const { data, error } = await supabase
    .from('devotional_daily_pages')
    .select('*')
    .eq('devotional_id', devotional.id)
    .eq('day_of_month', day)
    .maybeSingle();

  if (error) throw new Error(error.message ?? 'Unknown error');
  if (!data) return null;
  return { devotional, page: data };
}

export async function getAllPages(devotionalId: string): Promise<DevotionalDailyPage[]> {
  const { data, error } = await supabase
    .from('devotional_daily_pages')
    .select('*')
    .eq('devotional_id', devotionalId)
    .order('day_of_month', { ascending: true });

  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

export async function getDevotionalByMonth(
  month: number,
  year?: number
): Promise<{ devotional: MonthlyDevotional; allDays: DevotionalDailyPage[] } | null> {
  const devotional = await getMonthlyDevotional(month, year);
  if (!devotional) return null;
  const allDays = await getAllPages(devotional.id);
  return { devotional, allDays };
}

export async function createDevotional(data: CreateDevotionalInput): Promise<MonthlyDevotional> {
  const { data: row, error } = await supabase
    .from('monthly_devotionals')
    .insert({
      month: data.month,
      year: data.year,
      title: data.title,
      book_title: data.book_title,
      author: data.author ?? null,
      total_days: data.total_days,
      total_pages: data.total_pages,
      created_by: data.created_by,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message ?? 'Unknown error');
  return row;
}

export async function findDevotional(
  month: number,
  year: number,
  bookTitle: string
): Promise<MonthlyDevotional | null> {
  const { data, error } = await supabase
    .from('monthly_devotionals')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .eq('book_title', bookTitle)
    .maybeSingle();

  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? null;
}

/**
 * Reuses the month's existing row (matched on month, year and book title) and refreshes its details,
 * so a re-run does not hit the unique constraint or leave a second row behind.
 */
export async function getOrCreateDevotional(data: CreateDevotionalInput): Promise<MonthlyDevotional> {
  const existing = await findDevotional(data.month, data.year, data.book_title);
  if (!existing) return createDevotional(data);

  const { data: row, error } = await supabase
    .from('monthly_devotionals')
    .update({
      title: data.title,
      author: data.author ?? null,
      total_days: data.total_days,
      total_pages: data.total_pages,
    })
    .eq('id', existing.id)
    .select('*')
    .single();

  if (error) throw new Error(error.message ?? 'Unknown error');
  return row;
}

/** Replaces all day pages for a devotional. Called only after every image has uploaded. */
export async function replaceDailyPages(
  devotionalId: string,
  pages: Omit<CreateDailyPageInput, 'devotional_id'>[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('devotional_daily_pages')
    .delete()
    .eq('devotional_id', devotionalId);

  if (deleteError) throw new Error(deleteError.message ?? 'Unknown error');

  const { error } = await supabase.from('devotional_daily_pages').insert(
    pages.map((page) => ({
      devotional_id: devotionalId,
      day_of_month: page.day_of_month,
      page_range: page.page_range,
      image_url: page.image_url,
      title: page.title ?? null,
    }))
  );

  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function createDailyPage(data: CreateDailyPageInput): Promise<DevotionalDailyPage> {
  const { data: row, error } = await supabase
    .from('devotional_daily_pages')
    .insert({
      devotional_id: data.devotional_id,
      day_of_month: data.day_of_month,
      page_range: data.page_range,
      image_url: data.image_url,
      title: data.title ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message ?? 'Unknown error');
  return row;
}

export async function logView(
  memberId: string,
  devotionalId: string,
  dayOfMonth: number,
  viewedDate = new Date().toISOString().split('T')[0]
): Promise<DevotionalView> {
  const { data, error } = await supabase
    .from('devotional_views')
    .upsert(
      {
        member_id: memberId,
        devotional_id: devotionalId,
        day_of_month: dayOfMonth,
        viewed_date: viewedDate,
        viewed_at: new Date().toISOString(),
      },
      { onConflict: 'member_id,devotional_id,day_of_month,viewed_date' }
    )
    .select('*')
    .single();

  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function getViewForDay(
  memberId: string,
  devotionalId: string,
  dayOfMonth: number,
  viewedDate = new Date().toISOString().split('T')[0]
): Promise<DevotionalView | null> {
  const { data, error } = await supabase
    .from('devotional_views')
    .select('*')
    .eq('member_id', memberId)
    .eq('devotional_id', devotionalId)
    .eq('day_of_month', dayOfMonth)
    .eq('viewed_date', viewedDate)
    .maybeSingle();

  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? null;
}

export async function getEngagementStats(
  devotionalId: string,
  dayOfMonth: number
): Promise<DevotionalEngagementStats> {
  const { count, error } = await supabase
    .from('devotional_views')
    .select('id', { count: 'exact', head: true })
    .eq('devotional_id', devotionalId)
    .eq('day_of_month', dayOfMonth);

  if (error) throw new Error(error.message ?? 'Unknown error');

  const { data: latest, error: latestError } = await supabase
    .from('devotional_views')
    .select('viewed_at')
    .eq('devotional_id', devotionalId)
    .eq('day_of_month', dayOfMonth)
    .order('viewed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) throw latestError;

  return {
    devotional_id: devotionalId,
    day_of_month: dayOfMonth,
    viewed_count: count ?? 0,
    last_viewed_at: latest?.viewed_at ?? null,
  };
}

export async function listDevotionals(year: number): Promise<MonthlyDevotional[]> {
  const { data, error } = await supabase
    .from('monthly_devotionals')
    .select('*')
    .eq('year', year)
    .order('month', { ascending: true });

  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}
