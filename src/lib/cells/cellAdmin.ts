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
 * Checks a placement of a member into a cell (add, transfer or removal). `targetCellId` null means remove from cell.
 * Only active members may be placed. Pending and rejected accounts gain no cell scope.
 * A member in a Bible Study Class cannot change cell until they leave the class. A member who leads a cell cannot
 * change cell until another leader is assigned. The database enforces both rules too (migration 068 and 058).
 */
export function validateMemberPlacement(
  member: Pick<Member, 'id' | 'full_name' | 'status' | 'cell_id' | 'bsc_name'>,
  targetCellId: string | null,
  cells: Pick<Cell, 'id' | 'name' | 'leader_id'>[],
): string | null {
  if (targetCellId === null) {
    if (!member.cell_id) return `${member.full_name} is not in a cell.`;
  } else {
    if (member.status !== 'active') {
      return `Only active members can be added to a cell. ${member.full_name} is ${member.status ?? 'not active'}.`;
    }
    if (!cells.some((c) => c.id === targetCellId)) return 'Choose a cell that exists.';
    if (member.cell_id === targetCellId) return `${member.full_name} is already in this cell.`;
  }

  if (member.cell_id && member.bsc_name) {
    return `${member.full_name} is in the Bible Study Class “${member.bsc_name}”. Remove them from that class on the Bible Study Classes page, then change their cell.`;
  }

  const leads = cells.filter((c) => c.leader_id === member.id);
  if (member.cell_id && leads.length > 0) {
    const names = leads.map((c) => `“${c.name}”`).join(', ');
    const target = leads.length === 1 ? 'that cell' : 'those cells';
    return `${member.full_name} leads ${names}. Assign a new leader to ${target} before changing their cell.`;
  }

  return null;
}

export const CELL_CHANGE_REASON_MIN = 3;
export const CELL_CHANGE_REASON_MAX = 500;

/**
 * Every cell change needs a reason: a transfer, a removal or a pending-applicant placement (migration 093). The
 * database refuses a blank reason and records the trimmed one in member_cell_audit.
 */
export function validateCellChangeReason(reason: string): ValidationResult<string> {
  const value = reason.trim();
  if (value.length < CELL_CHANGE_REASON_MIN || value.length > CELL_CHANGE_REASON_MAX) {
    return {
      ok: false,
      error: `Give a reason for this cell change (${CELL_CHANGE_REASON_MIN} to ${CELL_CHANGE_REASON_MAX} characters).`,
    };
  }
  return { ok: true, value };
}

/** A cell can be archived only when no members are in it. Bible Study Classes are checked by the database. */
export function validateArchive(cellName: string, memberCount: number): string | null {
  if (memberCount > 0) {
    return `Move or remove the ${memberCount} ${memberCount === 1 ? 'member' : 'members'} in “${cellName}” before archiving it.`;
  }
  return null;
}
