import { supabase } from '../supabase';
import {
  canManageCells,
  validateCellName,
  validateLeaderCandidate,
  validateMemberPlacement,
  type CellActor,
} from '../cells/cellAdmin';
import type { Cell, Member } from '../../types';

/**
 * Write paths for cell administration. Each function:
 *   1. checks the acting user can manage cells (UX guard),
 *   2. validates the input against the current cell and member lists,
 *   3. performs one write and checks that exactly one row was saved.
 * RLS is the authority: cells_manage (coordinator-only) and the profile guards decide what the database accepts.
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
 * One profile row is written; the profile guard and staff-edit audit trigger record the change in the database.
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

  const { data, error } = await supabase
    .from('profiles')
    .update({ cell_id: targetCellId })
    .eq('id', member.id)
    .select('id, cell_id')
    .maybeSingle();
  if (error) fail(error.message, 'Could not update the member’s cell.');
  if (!data) fail(undefined, 'The member’s cell was not changed. Check that your account is still active.');
}
