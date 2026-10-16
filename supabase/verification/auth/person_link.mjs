// Decides how the approval test obtains the person record it links to the account. Pure: no database access.
//
// Ownership is proven by an exact per-run marker, not by timing. The signup carries full_name = `Cert Pending <run>`,
// where <run> is unique to this run. A person is usable only when its full_name equals that marker, its email equals
// the account email, no OTHER account is linked to it, and it was created by this run. If it is already linked to
// this run's own account (for example by the signup flow), the link step is skipped. Anything else fails closed.
export function planPersonForLink({ existing, accountEmail, ownerMarker, runStartIso, otherLinkedCount = 0, linkedToThisAccount = false, skewMs = 60000 }) {
  if (!existing) return { action: 'insert', ownedByRun: true };
  if (String(existing.email ?? '').toLowerCase() !== String(accountEmail).toLowerCase()) {
    return { action: 'refuse', reason: 'existing person email does not match the account email' };
  }
  if (otherLinkedCount > 0) {
    return { action: 'refuse', reason: 'existing person is already linked to another account' };
  }
  if (!ownerMarker || existing.full_name !== ownerMarker) {
    return { action: 'refuse', reason: 'existing person does not carry this run\'s ownership marker' };
  }
  const created = Date.parse(existing.created_at);
  if (!Number.isFinite(created) || created < Date.parse(runStartIso) - skewMs) {
    return { action: 'refuse', reason: 'existing person was not created by this run' };
  }
  return { action: linkedToThisAccount ? 'already-linked' : 'reuse', ownedByRun: true };
}
