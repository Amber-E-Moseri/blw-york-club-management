// Plans the removal of synthetic records this run tracked. Pure: no network. Only ids the run recorded are planned, in a
// safe order (contacts, people, bscs, cells, then accounts). Malformed ids are skipped and reported, never deleted.
const ORDER = ['contacts', 'people', 'bscs', 'cells', 'users'];
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
