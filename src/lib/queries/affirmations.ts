import { supabase } from '../supabase';
import type { Affirmation, AffirmationDeclaration } from '../../types';

export async function fetchAffirmationsForDate(date: string): Promise<Affirmation[]> {
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
      ...(row as unknown as Affirmation),
      declared_by_me: declarations.some((d) => d.user_id === userId),
      declaration_count: declarations.length,
    };
  });
}

export async function fetchUpcomingAffirmations(days = 7): Promise<Affirmation[]> {
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
      ...(row as unknown as Affirmation),
      declared_by_me: declarations.some((d) => d.user_id === userId),
      declaration_count: declarations.length,
    };
  });
}

export async function createAffirmation(input: {
  title: string;
  body: string;
  scheduled_date: string;
  created_by: string;
}): Promise<Affirmation> {
  const { data, error } = await supabase
    .from('confessions').insert(input).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** Inserts many affirmations in one statement, so either all of them are saved or none are. */
export async function createAffirmations(
  rows: { title: string; body: string; scheduled_date: string; created_by: string }[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase.from('confessions').insert(rows).select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function updateAffirmation(
  id: string,
  input: Partial<{ title: string; body: string; scheduled_date: string; is_active: boolean }>
): Promise<void> {
  const { error } = await supabase.from('confessions').update(input).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteAffirmation(id: string): Promise<void> {
  const { error } = await supabase.from('confessions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function declareAffirmation(
  affirmationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('confession_declarations')
    .upsert({ confession_id: affirmationId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function undeclareAffirmation(
  affirmationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('confession_declarations')
    .delete()
    .match({ confession_id: affirmationId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function fetchAffirmationDeclarations(affirmationId: string): Promise<AffirmationDeclaration[]> {
  const { data, error } = await supabase
    .from('confession_declarations')
    .select('*')
    .eq('confession_id', affirmationId);
  if (error) throw new Error(error.message);
  return data ?? [];
}
