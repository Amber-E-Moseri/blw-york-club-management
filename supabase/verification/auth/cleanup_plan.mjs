// Plans the removal of synthetic records this run tracked. Pure: no network. Only ids the run recorded are planned, in a
// safe order (contacts, people, accounts, bscs, then cells). Malformed ids are skipped and reported, never deleted.
// Accounts go before bscs: guard_bsc_delete_empty (055) raises if any profile still holds bsc_id. Cascading the
// auth-user delete first removes profiles via ON DELETE CASCADE, so the bsc guard finds no members. Bscs go before
// cells so guard_cell_lifecycle (072) finds no bscs in the cell and allows the delete.
const ORDER = ['contacts', 'people', 'users', 'bscs', 'cells'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function planCleanup(created) {
  const ops = [];
  const skipped = [];
  for (const kind of ORDER) {
    const ids = [...new Set(created?.[kind] ?? [])];
    for (const id of ids) {
      if (typeof id !== 'string' || !UUID.test(id)) {
        skipped.push(`${kind}: malformed id not deleted`);
        continue;
      }
      ops.push({ kind, id });
    }
  }
  return { ops, skipped };
}
