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
  cell_id: string | null;
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

/** Thrown when a write reports success but the database returned no row for it. Never shown as a success. */
export class NotSavedError extends Error {
  constructor(message = 'The change was not saved. Refresh and try again.') {
    super(message);
    this.name = 'NotSavedError';
  }
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function listCells(): Promise<CellOption[]> {
  const { data, error } = await supabase.from('cells').select('id, name').is('archived_at', null).order('name');
  fail(error);
  return data ?? [];
}

/** The cells the signed-in user leads (cells.leader_id). Empty for anyone who leads none. */
export async function fetchLedCellIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('cells').select('id').eq('leader_id', userId);
  fail(error);
  return (data ?? []).map((row) => row.id as string);
}

/** The BSCs the signed-in user leads (bscs.leader_id). RLS also requires an active account. */
export async function fetchLedBscIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('bscs').select('id').eq('leader_id', userId);
  fail(error);
  return (data ?? []).map((row) => row.id as string);
}

export async function listBscs(): Promise<BscRow[]> {
  const { data, error } = await supabase.from('bscs').select('id, cell_id, name, leader_id').order('name');
  fail(error);
  return data ?? [];
}

/** Creates a BSC and returns the stored row. Refused by the database if the leader is not an active member of the cell. */
export async function createBsc(input: { cell_id: string; name: string; leader_id: string | null }): Promise<BscRow> {
  const { data, error } = await supabase
    .from('bscs')
    .insert(input)
    .select('id, cell_id, name, leader_id')
    .maybeSingle();
  fail(error);
  if (!data) throw new NotSavedError('The BSC was not created. Check that you can lead this cell.');
  return data as BscRow;
}

/**
 * Sets (or clears) a BSC's leader and returns the stored row. An update that matches no row (RLS filtered it out)
 * is reported as NotSavedError, never as success.
 */
export async function setBscLeader(bscId: string, leaderId: string | null): Promise<BscRow> {
  const { data, error } = await supabase
    .from('bscs')
    .update({ leader_id: leaderId })
    .eq('id', bscId)
    .select('id, cell_id, name, leader_id')
    .maybeSingle();
  fail(error);
  if (!data) throw new NotSavedError('The BSC leader was not saved. You may not lead this cell.');
  return data as BscRow;
}

/** Active members of the BSC management picker (staff see everyone; a cell leader sees their cell's profiles). */
export async function listActiveMembers(): Promise<MemberRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, bsc_id, cell_id, role, status')
    .eq('status', 'active')
    .order('full_name');
  fail(error);
  return data ?? [];
}

/**
 * Moves a member into a BSC (or out of one when bscId is null) through the audited RPC. The RPC raises for every
 * refusal and for a zero-row write, so a resolved promise means the database stored the change.
 */
export async function assignMemberToBsc(memberId: string, bscId: string | null): Promise<void> {
  const { data, error } = await supabase.rpc('assign_member_to_bsc', {
    p_member_id: memberId,
    p_bsc_id: bscId,
  });
  fail(error);
  const rows = (data ?? []) as { member_id: string; bsc_id: string | null }[];
  const stored = rows.find((row) => row.member_id === memberId && row.bsc_id === bscId);
  if (!stored) throw new NotSavedError('The member was not moved. Refresh and try again.');
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
