import type { Cell, Member } from '../../types';

/**
 * Deterministic rules for cell administration. These run in the UI before a write and mirror what the database
 * enforces through RLS. They are a UX guard, not the authority: RLS on cells and profiles decides what is saved.
 */

export const CELL_NAME_MAX_LENGTH = 80;

export interface CellActor {
  role: string;
  status?: string;
}

/** Only active coordinators and admins may create, rename or reassign cells and members. */
export function canManageCells(actor: CellActor | null | undefined): boolean {
  return !!actor && actor.status === 'active' && (actor.role === 'coordinator' || actor.role === 'admin');
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Trims the name, then checks length and uniqueness (case-insensitive). `ignoreCellId` lets a rename keep its own name. */
export function validateCellName(
  raw: string,
  existing: Pick<Cell, 'id' | 'name'>[],
  ignoreCellId?: string,
): ValidationResult<string> {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0) return { ok: false, error: 'Enter a cell name.' };
  if (name.length > CELL_NAME_MAX_LENGTH) {
    return { ok: false, error: `Cell names can be at most ${CELL_NAME_MAX_LENGTH} characters.` };
  }
  const lower = name.toLowerCase();
  const clash = existing.some((c) => c.id !== ignoreCellId && c.name.trim().toLowerCase() === lower);
  if (clash) return { ok: false, error: `A cell called "${name}" already exists.` };
  return { ok: true, value: name };
}

/** A leader must be an active account. Pending, inactive and rejected accounts cannot lead a cell. */
export function validateLeaderCandidate(member: Pick<Member, 'full_name' | 'status'>): string | null {
  if (member.status !== 'active') {
    return `${member.full_name} must be an active member before they can lead a cell.`;
  }
  return null;
}

/**
 * Checks a placement of a member into a cell (add or transfer). `targetCellId` null means remove from cell.
 * Only active members may be placed. Pending and rejected accounts gain no cell scope.
 */
export function validateMemberPlacement(
  member: Pick<Member, 'full_name' | 'status' | 'cell_id'>,
  targetCellId: string | null,
  cells: Pick<Cell, 'id' | 'name'>[],
): string | null {
  if (targetCellId === null) {
    return member.cell_id ? null : `${member.full_name} is not in a cell.`;
  }
  if (member.status !== 'active') {
    return `Only active members can be added to a cell. ${member.full_name} is ${member.status ?? 'not active'}.`;
  }
  if (!cells.some((c) => c.id === targetCellId)) return 'Choose a cell that exists.';
  if (member.cell_id === targetCellId) return `${member.full_name} is already in this cell.`;
  return null;
}
