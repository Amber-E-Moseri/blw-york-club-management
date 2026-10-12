import { supabase } from '../supabase';

export interface CellOption {
  id: string;
  name: string;
}

export interface BscRow {
  id: string;
  cell_id: string;
  name: string;
  leader_id: string | null;
}

export interface MemberRow {
  id: string;
  full_name: string | null;
  email: string | null;
  bsc_id: string | null;
  role: string;
  status: string;
}

export interface VisibleMember {
  id: string;
  full_name: string | null;
  email: string | null;
  bsc_id: string;
  bsc_name: string;
  cell_id: string;
}

export interface RhapsodyRead {
  member_id: string;
  day_of_month: number;
  viewed_date: string;
}

export interface ConfessionDeclaration {
  user_id: string;
  created_at: string;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function listCells(): Promise<CellOption[]> {
  const { data, error } = await supabase.from('cells').select('id, name').order('name');
  fail(error);
  return data ?? [];
}

export async function listBscs(): Promise<BscRow[]> {
  const { data, error } = await supabase.from('bscs').select('id, cell_id, name, leader_id').order('name');
  fail(error);
  return data ?? [];
}

export async function createBsc(input: { cell_id: string; name: string; leader_id: string | null }): Promise<void> {
  const { error } = await supabase.from('bscs').insert(input);
  fail(error);
}

export async function listActiveMembers(): Promise<MemberRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, bsc_id, role, status')
    .eq('status', 'active')
    .order('full_name');
  fail(error);
  return data ?? [];
}

export async function assignMemberToBsc(memberId: string, bscId: string | null): Promise<void> {
  const { error } = await supabase.from('profiles').update({ bsc_id: bscId }).eq('id', memberId);
  fail(error);
}

export async function listVisibleBscMembers(): Promise<VisibleMember[]> {
  const { data, error } = await supabase.rpc('bsc_members_visible');
  fail(error);
  return (data ?? []) as VisibleMember[];
}

function monthBounds(month: number, year: number) {
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    startTs: new Date(year, month - 1, 1).toISOString(),
    endTs: new Date(year, month, 1).toISOString(),
  };
}

export async function listRhapsodyReads(memberIds: string[], month: number, year: number): Promise<RhapsodyRead[]> {
  if (memberIds.length === 0) return [];
  const { startDate, endDate } = monthBounds(month, year);
  const { data, error } = await supabase
    .from('devotional_views')
    .select('member_id, day_of_month, viewed_date')
    .in('member_id', memberIds)
    .gte('viewed_date', startDate)
    .lte('viewed_date', endDate);
  fail(error);
  return data ?? [];
}

export async function listConfessionDeclarations(
  memberIds: string[],
  month: number,
  year: number,
): Promise<ConfessionDeclaration[]> {
  if (memberIds.length === 0) return [];
  const { startTs, endTs } = monthBounds(month, year);
  const { data, error } = await supabase
    .from('confession_declarations')
    .select('user_id, created_at')
    .in('user_id', memberIds)
    .gte('created_at', startTs)
    .lt('created_at', endTs);
  fail(error);
  return (data ?? []).map((row) => ({ user_id: row.user_id, created_at: row.created_at }));
}
