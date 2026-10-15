// MailSlurp adapter for the OTP delivery check: reads the six-digit sign-up code from ONE fixed inbox.
//
// Endpoint (https://www.mailslurp.com/docs/wait-for): POST {base}/waitForMatchingFirstEmail?inboxId&since&timeout,
// header x-api-key, timeout in milliseconds. The reply is an Email whose text is in `body`.
//
// Stale-message protection: the search only considers mail received at or after `sinceIso`, which the caller captures
// BEFORE the signup request. A returned message older than `sinceIso` is also ignored client-side.
//
// Never logs or returns the API key. Errors carry the HTTP status only.

const SIX_DIGIT = /\b(\d{6})\b/;
const NO_MESSAGE_YET = 408;
const POLL_PAUSE_MS = 5000;

/**
 * Waits until a sign-up code arrives in the fixed inbox, or the deadline passes.
 * Returns { status: 'code', code, receivedAt } | { status: 'timeout' } | { status: 'blocked', reason }.
 * Pure apart from the injected fetch/clock/sleep, so the failure paths are unit-testable.
 */
export async function waitForSignupCode({
  base,
  apiKey,
  inboxId,
  sinceIso,
  deadlineMs,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const sinceMs = Date.parse(sinceIso);
  while (now() < deadlineMs) {
    const remaining = Math.max(1000, deadlineMs - now());
    const query = new URLSearchParams({ inboxId, since: sinceIso, timeout: String(remaining) });
    const r = await fetchImpl(`${base}/waitForMatchingFirstEmail?${query}`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ matches: [] }),
    });
    if (r.status === 200) {
      const email = await r.json();
      const receivedMs = email.createdAt ? Date.parse(email.createdAt) : NaN;
      const stale = Number.isFinite(receivedMs) && receivedMs < sinceMs;
      const m = stale ? null : SIX_DIGIT.exec(email.body ?? email.text ?? '');
      if (m) return { status: 'code', code: m[1], receivedAt: email.createdAt ?? null };
    } else if (r.status !== NO_MESSAGE_YET) {
      return { status: 'blocked', reason: `test inbox returned HTTP ${r.status}; the approved mail path is not usable` };
    }
    if (now() < deadlineMs) await sleep(Math.min(POLL_PAUSE_MS, Math.max(0, deadlineMs - now())));
  }
  return { status: 'timeout' };
}
