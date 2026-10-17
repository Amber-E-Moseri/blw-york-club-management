import type { Cell, Member } from '../types';

export const CELL_NAME_MAX_LENGTH = 80;

/** Returns an error message for an unusable cell name, or null when the trimmed name is acceptable. */
export function validateCellName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a cell name.';
  if (trimmed.length > CELL_NAME_MAX_LENGTH) return `Cell names can be at most ${CELL_NAME_MAX_LENGTH} characters.`;
  return null;
}

export interface CellSummary {
  id: string;
  name: string;
  leaderName: string | null;
  members: Member[];
}

/**
 * Joins cells to their leader and members. Members are sorted by name. A leader who is not in the member list
 * still gets a name when the leader_id matches a directory entry; otherwise leaderName is null.
 */
export function summarizeCells(cells: Cell[], members: Member[]): CellSummary[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const membersByCell = new Map<string, Member[]>();
  for (const member of members) {
    if (!member.cell_id) continue;
    const list = membersByCell.get(member.cell_id) ?? [];
    list.push(member);
    membersByCell.set(member.cell_id, list);
  }

  return cells.map((cell) => ({
    id: cell.id,
    name: cell.name,
    leaderName: cell.leader_id ? byId.get(cell.leader_id)?.full_name ?? null : null,
    members: (membersByCell.get(cell.id) ?? []).sort((a, b) => a.full_name.localeCompare(b.full_name)),
  }));
}
