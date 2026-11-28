// Shared rules for approved Hub accounts. These are not organizational-membership rules.
//
// Two existing models are in the schema and are NOT merged here:
//   * profiles.status (migrations 016, 019, 022): the account's approval state. 'active' means an approved account.
//     Pending, rejected and inactive accounts are registered but not approved.
//   * people and memberships (migrations 015, 018, 045): the authority for organizational membership.
//
// Existing operational counts continue to use approval state until reconciliation is complete, but labels and the
// reconciliation views distinguish them from verified organizational members.

/** The profiles.status value that marks an approved account. */
export const APPROVED_STATUS = 'active' as const;

export interface AccountStatusLike {
  status?: string | null;
}

/** True only for an approved account. A missing or unrecognised status is not approved. */
export function isApprovedMember(row: AccountStatusLike | null | undefined): boolean {
  return row?.status === APPROVED_STATUS;
}

/** The approved accounts in a list. */
export function approvedMembers<T extends AccountStatusLike>(rows: readonly T[]): T[] {
  return rows.filter(isApprovedMember);
}

/** Approved accounts with no cell. A pending or rejected account without a cell is not counted as unassigned. */
export function unassignedApprovedMembers<T extends AccountStatusLike & { cell_id?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => isApprovedMember(row) && !row.cell_id);
}

/** Approved member count per cell id. Cells with no approved members are absent, so the caller can show zero. */
export function approvedCountByCell<T extends AccountStatusLike & { cell_id?: string | null }>(
  rows: readonly T[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isApprovedMember(row) || !row.cell_id) continue;
    counts.set(row.cell_id, (counts.get(row.cell_id) ?? 0) + 1);
  }
  return counts;
}
