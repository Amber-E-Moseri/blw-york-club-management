import type { AuthUser } from './auth';

/**
 * Leadership capability for the Hub. One rule, derived from the authoritative assignment: `cells.leader_id`.
 *
 * - A user leads a cell only when that cell's leader_id is the user's id and the account is active.
 * - The `cell_leader` profile role confers nothing on its own. A role-only account gets no leader pages or controls.
 * - Admins and coordinators are staff. Their access does not depend on any cell assignment.
 *
 * This mirrors the database (`is_cell_leader_of`, migration 065) for navigation and display only. The database is the
 * authority: every read and write is still checked there, and a stale or wrong value here cannot widen access.
 */

/** A cell as this capability needs it: the id, the name for display, and the canonical leader. */
export interface LedCell {
  id: string;
  name: string;
  leader_id: string | null;
}

export interface LeadershipCapability {
  /** Admin or coordinator, on an active account. Staff authority does not depend on any cell assignment. */
  isStaff: boolean;
  /** Cells the signed-in user leads. Empty when unassigned, removed, reassigned away, or the account is not active. */
  ledCells: LedCell[];
  /** True when the user leads at least one cell. The `cell_leader` role is never enough. */
  isCellLeader: boolean;
  /** Staff, or an assigned cell leader: may open leader pages and see leader controls. */
  canUseLeaderPages: boolean;
}

/** Full state exposed to components: the capability plus the lookup's loading and error state. */
export interface LeadershipState extends LeadershipCapability {
  /** True while assignments are being read. Leader pages show a loading state, never a denial, during this time. */
  loading: boolean;
  /** Set when the lookup failed. Fails closed: no cells are granted while this is set. */
  error: string | null;
  /** Re-reads assignments, for example after a leader change. */
  refresh: () => void;
}

type CapabilityUser = Pick<AuthUser, 'id' | 'role' | 'status'>;

/**
 * Pure derivation from the signed-in user and the cells that user was returned as leading. Rows whose leader_id is not
 * the user are ignored here as well, so the result never depends on the query alone.
 */
export function deriveLeadership(user: CapabilityUser | null | undefined, cells: LedCell[]): LeadershipCapability {
  const active = user?.status === 'active';
  const isStaff = Boolean(active && user && (user.role === 'admin' || user.role === 'coordinator'));
  const ledCells = active && user ? cells.filter((cell) => cell.leader_id === user.id) : [];
  const isCellLeader = ledCells.length > 0;
  return { isStaff, ledCells, isCellLeader, canUseLeaderPages: isStaff || isCellLeader };
}

/** Fail-closed value used when no provider is mounted or while nothing is known. Grants nothing. */
export const CLOSED_LEADERSHIP: LeadershipCapability = deriveLeadership(null, []);

/**
 * The scope that data queries apply to the signed-in user. Built from the same capability as the navigation and the
 * route guards, so display and data never disagree. Staff see everything the database allows; a leader is scoped to
 * the cells they lead; anyone else is scoped to their own records.
 */
export interface LeadershipScope {
  isStaff: boolean;
  ledCellIds: string[];
}

export const NO_SCOPE: LeadershipScope = { isStaff: false, ledCellIds: [] };

export function scopeFrom(capability: LeadershipCapability): LeadershipScope {
  return { isStaff: capability.isStaff, ledCellIds: capability.ledCells.map((cell) => cell.id) };
}
