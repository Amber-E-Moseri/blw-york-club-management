// Protected inquiry path: the website-inquiry Edge Function checks Turnstile and the per-client limit before the database
// accepts the message. Used whenever a Turnstile site key is configured, so visitors cannot bypass those checks.

export interface ProtectedInquiry {
  kind: 'contact' | 'new_here' | 'prayer';
  name: string;
  email: string;
  phone: string;
  message: string;
  topic: string;
  consentVersion: string;
  consentTextHash: string;
  honeypot: string;
  turnstileToken: string;
}

const GENERIC_FAILURE = 'Your message could not be sent. Please try again in a few minutes.';
const NETWORK_FAILURE = 'We could not reach the server. Check your connection and try again.';

export async function postProtectedInquiry(
  url: string,
  anonKey: string,
  body: ProtectedInquiry,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${url}/functions/v1/website-inquiry`, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(NETWORK_FAILURE);
  }
  if (res.status === 202) return;
  // Only the server's visitor-facing message is shown. Anything unexpected gets the generic wording.
  const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof json?.error === 'string' && json.error.length <= 300 ? json.error : GENERIC_FAILURE);
}
