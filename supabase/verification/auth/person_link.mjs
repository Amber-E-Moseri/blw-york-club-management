// Decides how the approval test obtains the person record it links to the account. Pure: no database access.
//
// The person's email must equal the account's confirmed email, and only one person may hold that email. The signup
// flow can create that person, so the harness reuses it only when the record is clearly this run's own record.
// Anything else fails closed: a foreign or leftover row is never attached to the account and never deleted.
export function planPersonForLink({ existing, accountEmail, runStartIso, linkedProfileCount = 0, skewMs = 60000 }) {
  if (!existing) return { action: 'insert', ownedByRun: true };
  if (String(existing.email ?? '').toLowerCase() !== String(accountEmail).toLowerCase()) {
    return { action: 'refuse', reason: 'existing person email does not match the account email' };
  }
  if (linkedProfileCount > 0) {
    return { action: 'refuse', reason: 'existing person is already linked to an account' };
  }
  const created = Date.parse(existing.created_at);
  if (!Number.isFinite(created) || created < Date.parse(runStartIso) - skewMs) {
    return { action: 'refuse', reason: 'existing person was not created by this run' };
  }
  return { action: 'reuse', ownedByRun: true };
}
