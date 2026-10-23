import { supabase } from '../supabase';
import type { Affirmation as Confession, AffirmationDeclaration as ConfessionDeclaration } from '../../types';

export async function fetchConfessionsForDate(date: string): Promise<Confession[]> {
  const userId = (await supabase.auth.getUser()).data.user?.id;

  const { data, error } = await supabase
    .from('confessions')
    .select('*, confession_declarations(user_id)')
    .eq('scheduled_date', date)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const declarations = (row.confession_declarations as { user_id: string }[]) ?? [];
    return {
      ...(row as unknown as Confession),
      declared_by_me: declarations.some((d) => d.user_id === userId),
      declaration_count: declarations.length,
    };
  });
}

export async function fetchUpcomingConfessions(days = 7): Promise<Confession[]> {
  const today = new Date().toISOString().split('T')[0];
  const until = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
  const userId = (await supabase.auth.getUser()).data.user?.id;

  const { data, error } = await supabase
    .from('confessions')
    .select('*, confession_declarations(user_id)')
    .gte('scheduled_date', today)
    .lte('scheduled_date', until)
    .eq('is_active', true)
    .order('scheduled_date', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const declarations = (row.confession_declarations as { user_id: string }[]) ?? [];
    return {
      ...(row as unknown as Confession),
      declared_by_me: declarations.some((d) => d.user_id === userId),
      declaration_count: declarations.length,
    };
  });
}

export async function createConfession(input: {
  title: string;
  body: string;
  scheduled_date: string;
  created_by: string;
}): Promise<Confession> {
  const { data, error } = await supabase
    .from('confessions').insert(input).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateConfession(
  id: string,
  input: Partial<{ title: string; body: string; scheduled_date: string; is_active: boolean }>
): Promise<void> {
  const { error } = await supabase.from('confessions').update(input).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteConfession(id: string): Promise<void> {
  const { error } = await supabase.from('confessions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function declareConfession(
  confessionId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('confession_declarations')
    .upsert({ confession_id: confessionId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function undeclareConfession(
  confessionId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('confession_declarations')
    .delete()
    .match({ confession_id: confessionId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function fetchDeclarations(confessionId: string): Promise<ConfessionDeclaration[]> {
  const { data, error } = await supabase
    .from('confession_declarations')
    .select('*')
    .eq('confession_id', confessionId);
  if (error) throw new Error(error.message);
  return data ?? [];
}
