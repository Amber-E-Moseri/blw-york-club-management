// External link rules. Every outbound button on the public site passes through here so the rules are enforced once:
// https only, no embedded credentials, and the link is opened with noopener and noreferrer.

/** Returns the URL if it is a safe https destination, otherwise null. */
export function safeHttpsUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const EXTERNAL_LINK_REL = 'noopener noreferrer';
