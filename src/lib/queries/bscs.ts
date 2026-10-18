import { supabase } from '../supabase';
import type { Bsc } from '../../types';

export async function fetchBscsByCell(cellId: string): Promise<Bsc[]> {
  const { data, error } = await supabase
    .from('bscs')
    .select('id, cell_id, name, leader_id')
    .eq('cell_id', cellId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message ?? 'Failed to load BSCs.');
  return (data ?? []) as Bsc[];
}

export async function createBsc(cellId: string, name: string): Promise<Bsc> {
  const { data, error } = await supabase
    .from('bscs')
    .insert({ cell_id: cellId, name: name.trim() })
    .select('id, cell_id, name, leader_id')
    .single();
  if (error) throw new Error(error.message ?? 'Failed to create BSC.');
  return data as Bsc;
}

export async function assignBscLeader(bscId: string, leaderId: string): Promise<void> {
  const { error } = await supabase
    .from('bscs').update({ leader_id: leaderId }).eq('id', bscId);
  if (error) throw new Error(error.message ?? 'Could not assign BSC leader.');
}

export async function assignMemberToBsc(memberId: string, bscId: string | null): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ bsc_id: bscId })
    .eq('id', memberId);
  if (error) throw new Error(error.message ?? 'Failed to assign member to BSC.');
}
