// Decides how the approval test obtains the person record it links to the account. Pure: no database access.
//
// Ownership is proven by an exact per-run marker, not by timing. The signup carries full_name = `Cert Pending <run>`,
// where <run> is unique to this run, so a person is reusable only when its full_name equals that marker, its email
// equals the account email, and no account is linked to it. Creation time is an extra, not a proof. Anything else
// fails closed: a foreign, leftover or unmarked row is never attached to the account and never deleted.
export function planPersonForLink({ existing, accountEmail, ownerMarker, runStartIso, linkedProfileCount = 0, skewMs = 60000 }) {
  if (!existing) return { action: 'insert', ownedByRun: true };
  if (String(existing.email ?? '').toLowerCase() !== String(accountEmail).toLowerCase()) {
    return { action: 'refuse', reason: 'existing person email does not match the account email' };
  }
  if (linkedProfileCount > 0) {
    return { action: 'refuse', reason: 'existing person is already linked to an account' };
  }
  if (!ownerMarker || existing.full_name !== ownerMarker) {
    return { action: 'refuse', reason: 'existing person does not carry this run\'s ownership marker' };
  }
  const created = Date.parse(existing.created_at);
  if (!Number.isFinite(created) || created < Date.parse(runStartIso) - skewMs) {
    return { action: 'refuse', reason: 'existing person was not created by this run' };
  }
  return { action: 'reuse', ownedByRun: true };
}
