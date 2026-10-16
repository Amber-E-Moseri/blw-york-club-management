// Reads the new user's id from a GoTrue signup response. Accepts the wrapped shape ({ user: { id } }) and the top-level
// user shape ({ id }). Anything else fails closed with sanitized diagnostics: HTTP status, top-level key names and
// error_code only. The response body, tokens and the email are never included in the message.
export function signupUserId(response) {
  const data = response?.data;
  const wrapped = data?.user?.id;
  const topLevel = data?.id;
  const id = typeof wrapped === 'string' && wrapped ? wrapped : typeof topLevel === 'string' && topLevel ? topLevel : null;
  if (id) return id;
  const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 12).join(',') : typeof data;
  const code = typeof data?.error_code === 'string' ? data.error_code.slice(0, 60) : 'none';
  throw new Error(`signup returned no user: HTTP ${response?.status ?? 'unknown'}; response keys=[${keys}]; error_code=${code}`);
}
