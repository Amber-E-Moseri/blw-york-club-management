import { supabase } from '../supabase';
import {
  canManageCells,
  validateCellName,
  validateLeaderCandidate,
  validateArchive,
  validateMemberPlacement,
  type CellActor,
} from '../cells/cellAdmin';
import type { Cell, Member } from '../../types';

/**
 * Write paths for cell administration. Each function:
 *   1. checks the acting user can manage cells (UX guard),
 *   2. validates the input against the current cell and member lists,
 *   3. performs one write and checks that exactly one row was saved.
 * RLS is the authority: cells_manage (admins and coordinators, migration 068), the transfer RPC and the profile and
 * cell guards decide what the database accepts.
 * A silent zero-row update is reported as a failure, because RLS denial returns no error.
 */

function requireManager(actor: CellActor | null | undefined): void {
  if (!canManageCells(actor)) {
    throw new Error('Only active coordinators and admins can manage cells.');
  }
}

function fail(message: string | undefined, fallback: string): never {
  throw new Error(message && message.length > 0 ? message : fallback);
}

export async function createCell(name: string, actor: CellActor, existing: Cell[]): Promise<Cell> {
  requireManager(actor);
  const check = validateCellName(name, existing);
  if (!check.ok) throw new Error(check.error);

  const { data, error } = await supabase
    .from('cells')
    .insert({ name: check.value })
    .select('id, name, leader_id')
    .maybeSingle();
  if (error) fail(error.message, 'Could not create the cell.');
  if (!data) fail(undefined, 'The cell was not saved. Check that your account is still active.');
  return data as Cell;
}

export async function renameCell(
  cellId: string,
  name: string,
  actor: CellActor,
  existing: Cell[],
): Promise<void> {
  requireManager(actor);
  const check = validateCellName(name, existing, cellId);
  if (!check.ok) throw new Error(check.error);

  const { data, error } = await supabase
    .from('cells')
    .update({ name: check.value })
    .eq('id', cellId)
    .select('id')
    .maybeSingle();
  if (error) fail(error.message, 'Could not rename the cell.');
  if (!data) fail(undefined, 'The cell was not renamed. It may have been removed.');
}

/** Assigns a leader, or clears the leader when `leaderId` is null. The leader must be an active member. */
export async function setCellLeader(
  cellId: string,
  leaderId: string | null,
  actor: CellActor,
  members: Member[],
): Promise<void> {
  requireManager(actor);
  if (leaderId) {
    const candidate = members.find((m) => m.id === leaderId);
    if (!candidate) throw new Error('That leader is not in the member directory.');
    const problem = validateLeaderCandidate(candidate);
    if (problem) throw new Error(problem);
  }

  const { data, error } = await supabase
    .from('cells')
    .update({ leader_id: leaderId })
    .eq('id', cellId)
    .select('id')
    .maybeSingle();
  if (error) fail(error.message, 'Could not update the cell leader.');
  if (!data) fail(undefined, 'The leader was not saved. The cell may have been removed.');
}

/**
 * Places a member in a cell (add or transfer), or removes them from their cell when `targetCellId` is null.
 * Goes through transfer_member_cell (migration 068), which checks authorization, active status, Bible Study Class
 * membership and cell leadership, then writes the row and its audit record in one transaction. The RPC returns the
 * saved row, so a refused or unsaved write is reported as a failure.
 */
export async function setMemberCell(
  member: Member,
  targetCellId: string | null,
  actor: CellActor,
  cells: Cell[],
): Promise<void> {
  requireManager(actor);
  const problem = validateMemberPlacement(member, targetCellId, cells);
  if (problem) throw new Error(problem);

  const { data, error } = await supabase.rpc('transfer_member_cell', {
    p_member_id: member.id,
    p_cell_id: targetCellId,
  });
  if (error) fail(error.message, 'Could not change the member’s cell.');
  if (!Array.isArray(data) || data.length !== 1) {
    fail(undefined, 'The member’s cell was not changed. Check that your account is still active.');
  }
}

/**
 * Archives a cell, or restores it when `archived` is false. Archiving is refused while members are in the cell. Bible
 * Study Classes are checked by the database, and the message it returns is shown as-is.
 */
export async function setCellArchived(
  cell: Cell,
  archived: boolean,
  actor: CellActor,
  members: Member[],
): Promise<void> {
  requireManager(actor);
  if (archived) {
    const problem = validateArchive(cell.name, members.filter((m) => m.cell_id === cell.id).length);
    if (problem) throw new Error(problem);
  }

  const { data, error } = await supabase
    .from('cells')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', cell.id)
    .select('id')
    .maybeSingle();
  if (error) fail(error.message, archived ? 'Could not archive the cell.' : 'Could not restore the cell.');
  if (!data) fail(undefined, 'The cell was not saved. It may have been removed.');
}

/** Archived cells, for the restore list. Active cells come from fetchCells, which excludes archived ones. */
export async function fetchArchivedCells(): Promise<Cell[]> {
  const { data, error } = await supabase
    .from('cells')
    .select('id, name, leader_id')
    .not('archived_at', 'is', null)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message ?? 'Could not load archived cells.');
  return (data ?? []) as Cell[];
}

/**
 * Bible Study Class names by member id, for the members the viewer can see. The database returns only rows the viewer
 * is allowed to see (bsc_members_visible, migration 058). A missing entry therefore does not prove that a member has no
 * class; the transfer RPC still refuses the change.
 */
export async function fetchBscMembershipNames(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('bsc_members_visible');
  if (error) throw new Error(error.message ?? 'Could not load Bible Study Class memberships.');
  const names: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ id: string; bsc_name: string }>) {
    names[row.id] = row.bsc_name;
  }
  return names;
}
