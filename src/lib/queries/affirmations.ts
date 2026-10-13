import { supabase } from '../supabase';
import type { Affirmation } from '../../types';

/**
 * Adds declaration_count (every member, via an aggregate that returns counts only) and declared_by_me (the caller's own
 * declaration row, the only declaration row a member may read). No other member's identity or timestamp is fetched.
 */
async function withDeclarationSummary(rows: Record<string, unknown>[], userId: string | undefined): Promise<Affirmation[]> {
  const ids = rows.map((r) => r.id as string);
  if (ids.length === 0) return [];

  const [{ data: counts, error: countError }, { data: own, error: ownError }] = await Promise.all([
    supabase.rpc('confession_declaration_counts', { p_confession_ids: ids }),
    userId
      ? supabase.from('confession_declarations').select('confession_id').eq('user_id', userId).in('confession_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (countError) throw new Error(countError.message);
  if (ownError) throw new Error(ownError.message);

  const countById = new Map<string, number>(
    ((counts ?? []) as { confession_id: string; declaration_count: number | string }[]).map((c) => [c.confession_id, Number(c.declaration_count)]),
  );
  const declaredIds = new Set(((own ?? []) as { confession_id: string }[]).map((d) => d.confession_id));

  return rows.map((row) => ({
    ...(row as unknown as Affirmation),
    declared_by_me: declaredIds.has(row.id as string),
    declaration_count: countById.get(row.id as string) ?? 0,
  }));
}

export async function fetchAffirmationsForDate(date: string): Promise<Affirmation[]> {
  const userId = (await supabase.auth.getUser()).data.user?.id;

  const { data, error } = await supabase
    .from('confessions')
    .select('*')
    .eq('scheduled_date', date)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return withDeclarationSummary((data ?? []) as Record<string, unknown>[], userId);
}

export async function fetchUpcomingAffirmations(days = 7): Promise<Affirmation[]> {
  const today = new Date().toISOString().split('T')[0];
  const until = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
  const userId = (await supabase.auth.getUser()).data.user?.id;

  const { data, error } = await supabase
    .from('confessions')
    .select('*')
    .gte('scheduled_date', today)
    .lte('scheduled_date', until)
    .eq('is_active', true)
    .order('scheduled_date', { ascending: true });

  if (error) throw new Error(error.message);

  return withDeclarationSummary((data ?? []) as Record<string, unknown>[], userId);
}

export async function createAffirmation(input: {
  title: string;
  body: string;
  scheduled_date: string;
  created_by: string;
  /** null = fellowship-wide broadcast (live); otherwise the frozen audience spec (migration 072). */
  audience_spec_id?: string | null;
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
