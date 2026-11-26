import { supabase } from '../supabase';
import type { HabitTemplate, HabitTemplateInput, HabitEntry, HabitMemberAnalytics } from '../../types';
import { shiftDateKey, toLocalDateKey } from '../dates';

export async function fetchHabitTemplates(): Promise<HabitTemplate[]> {
  const { data, error } = await supabase
    .from('habit_templates')
    .select('*')
    .eq('is_active', true)
    .order('order');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchAllHabitTemplates(): Promise<HabitTemplate[]> {
  const { data, error } = await supabase
    .from('habit_templates')
    .select('*')
    .order('order');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createHabitTemplate(
  input: HabitTemplateInput,
  userId: string,
): Promise<HabitTemplate> {
  const { data: last } = await supabase
    .from('habit_templates')
    .select('order')
    .order('order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from('habit_templates')
    .insert({ ...input, created_by: userId, is_active: true, order: (last?.order ?? 0) + 1 })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateHabitTemplate(
  id: string,
  input: Partial<HabitTemplateInput & { is_active: boolean; order: number }>,
): Promise<HabitTemplate> {
  const { data, error } = await supabase
    .from('habit_templates')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteHabitTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('habit_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function fetchHabitEntries(
  userId: string,
  dateFrom: string,
  dateTo: string,
): Promise<HabitEntry[]> {
  const { data, error } = await supabase
    .from('habit_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('entry_date', dateFrom)
    .lte('entry_date', dateTo)
    .order('entry_date');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function upsertHabitEntry(
  userId: string,
  templateId: string,
  entryDate: string,
  status: 'done' | 'skipped',
): Promise<HabitEntry> {
  const { data, error } = await supabase
    .from('habit_entries')
    .upsert(
      { user_id: userId, template_id: templateId, entry_date: entryDate, status },
      { onConflict: 'user_id,template_id,entry_date' },
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteHabitEntry(
  userId: string,
  templateId: string,
  entryDate: string,
): Promise<void> {
  const { error } = await supabase
    .from('habit_entries')
    .delete()
    .eq('user_id', userId)
    .eq('template_id', templateId)
    .eq('entry_date', entryDate);
  if (error) throw new Error(error.message);
}

export async function fetchHabitAnalytics(): Promise<HabitMemberAnalytics[]> {
  const today = toLocalDateKey();
  const sevenDaysAgo = shiftDateKey(today, -6);

  const [templates, entriesResult] = await Promise.all([
    fetchAllHabitTemplates(),
    supabase
      .from('habit_entries')
      .select('template_id, user_id, entry_date, status')
      .gte('entry_date', sevenDaysAgo)
      .lte('entry_date', today),
  ]);

  if (entriesResult.error) throw new Error(entriesResult.error.message);
  const allEntries = entriesResult.data ?? [];

  return templates.map((t) => {
    const tEntries = allEntries.filter((e) => e.template_id === t.id);
    const doneToday = tEntries.filter(
      (e) => e.entry_date === today && e.status === 'done',
    ).length;
    const uniqueUsers = new Set(tEntries.map((e) => e.user_id)).size;
    const doneCount = tEntries.filter((e) => e.status === 'done').length;
    const totalPossible = uniqueUsers * 7;

    return {
      template_id: t.id,
      habit_name: t.name,
      icon: t.icon,
      member_count: uniqueUsers,
      done_today: doneToday,
      completion_7d_avg: totalPossible > 0 ? doneCount / totalPossible : 0,
    };
  });
}
