// Plans the removal of synthetic records this run tracked. Pure: no network. Only ids the run recorded are planned, in a
// safe order (contacts, people, bscs, accounts, then cells). Malformed ids are skipped and reported, never deleted.
// Accounts go before cells, so a cell still holding members of a removed account is not blocked from deletion.
const ORDER = ['contacts', 'people', 'bscs', 'users', 'cells'];
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
