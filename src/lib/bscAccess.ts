import type { AuthUser } from './auth';

/**
 * What the current actor may see and do on the BSC screens. This only decides which controls to show. The database
 * (RLS policies, guard triggers and the assign_member_to_bsc RPC) is the authority, and every write is still verified
 * against the rows it returns.
 */
export interface BscLeadership {
  /** Cell ids where cells.leader_id = the current user. */
  ledCellIds: string[];
  /** BSC ids where bscs.leader_id = the current user. */
  ledBscIds: string[];
}

export interface BscCapabilities {
  /** Active admin or coordinator. */
  isStaff: boolean;
  /** Assign or move members between BSCs (staff only). */
  canManageRoster: boolean;
  /** Create BSCs and choose their leaders: staff everywhere, a cell leader only in a led cell. */
  canCreateBsc: boolean;
  /** Can open the BSC management screen at all. */
  canOpenManagement: boolean;
  /** Can open My BSC: staff, any cell leader of a cell, or any active BSC leader. */
  canViewMyBsc: boolean;
}

const STAFF_ROLES: AuthUser['role'][] = ['admin', 'coordinator'];

export function deriveBscCapabilities(
  user: Pick<AuthUser, 'role' | 'status'> | null,
  leadership: BscLeadership,
): BscCapabilities {
  const active = user?.status === 'active';
  const isStaff = active && STAFF_ROLES.includes(user?.role ?? 'member');
  const ledCell = leadership.ledCellIds.length > 0;
  const ledBsc = leadership.ledBscIds.length > 0;

  return {
    isStaff,
    canManageRoster: isStaff,
    canCreateBsc: isStaff || (active && ledCell),
    canOpenManagement: isStaff || (active && ledCell),
    canViewMyBsc: isStaff || (active && (ledCell || ledBsc)),
  };
}
