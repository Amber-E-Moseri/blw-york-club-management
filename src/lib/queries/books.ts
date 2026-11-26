import { supabase } from '../supabase';
import type { BookOfMonth, BookOfMonthInput } from '../../types';
import { toLocalDateKey } from '../dates';

export async function getCurrentBook(): Promise<BookOfMonth | null> {
  const today = toLocalDateKey();
  const { data, error } = await supabase
    .from('books_of_month')
    .select('*')
    .lte('active_from', today)
    .gte('active_until', today)
    .order('active_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data as BookOfMonth | null;
}

export async function getAllBooks(): Promise<BookOfMonth[]> {
  const { data, error } = await supabase
    .from('books_of_month')
    .select('*')
    .order('active_from', { ascending: false });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return (data ?? []) as BookOfMonth[];
}

export async function createBook(input: BookOfMonthInput & { created_by: string }): Promise<BookOfMonth> {
  const { data, error } = await supabase
    .from('books_of_month').insert(input).select().single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data as BookOfMonth;
}

export async function updateBook(id: string, input: Partial<BookOfMonthInput>): Promise<BookOfMonth> {
  const { data, error } = await supabase
    .from('books_of_month').update(input).eq('id', id).select().single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data as BookOfMonth;
}

export async function deleteBook(id: string): Promise<void> {
  const { error } = await supabase.from('books_of_month').delete().eq('id', id);
  if (error) throw new Error(error.message ?? 'Unknown error');
}
