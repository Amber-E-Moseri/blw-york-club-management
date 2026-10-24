// Local gate test for the website-inquiry Edge Function (migration 112).
//
// The function module is loaded unchanged. Its Deno.serve call is captured, and its outbound calls are routed:
//   * Turnstile siteverify is answered by the test (only the token "good-token" passes);
//   * PostgREST RPC calls run against a disposable local PostgreSQL 17 database as the role that the API key maps to
//     (service key -> service_role, public key -> anon), so the real grants decide what succeeds.
// Nothing here touches a hosted Supabase project, a production project or real Turnstile.
//
// Run: deno test -A supabase/verification/edge/website_inquiry_gate_test.ts
// Needs: TEST_DB (a database built from migrations 000-112), PSQL_BIN, PG_PORT (default 55417).

const SUPABASE_URL = 'http://supabase.gate.invalid';
const ANON_KEY = 'anon-public-key-for-tests';
const SERVICE_KEY = 'service-role-key-for-tests';
const PSQL_BIN = Deno.env.get('PSQL_BIN') ?? 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const TEST_DB = Deno.env.get('TEST_DB') ?? 'cms_edge_test';
const PG_PORT = Deno.env.get('PG_PORT') ?? '55417';

Deno.env.set('SUPABASE_URL', SUPABASE_URL);
Deno.env.set('SUPABASE_ANON_KEY', ANON_KEY);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);
Deno.env.set('TURNSTILE_SECRET_KEY', 'turnstile-secret-for-tests');
Deno.env.set('CLIENT_HASH_SECRET', 'x'.repeat(40));
Deno.env.set('WEBSITE_ALLOWED_ORIGINS', 'https://site.example');

type RpcCall = { fn: string; role: string; apikey: string };
const rpcCalls: RpcCall[] = [];
const realFetch = globalThis.fetch;

// Capture the handler that the module registers with Deno.serve.
const captured: { handler: ((req: Request) => Promise<Response>) | null } = { handler: null };
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: (req: Request) => Promise<Response>) => {
  captured.handler = h;
  return { finished: Promise.resolve() };
};
await import(new URL('../../functions/website-inquiry/index.ts', import.meta.url).href);
const serve = captured.handler;
if (!serve) throw new Error('website-inquiry did not register a handler');

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function runSql(role: string, statement: string): Promise<{ ok: true; out: string } | { ok: false; code: string; message: string }> {
  // ON_ERROR_STOP makes psql exit non-zero on a refused statement, so a denied call is never mistaken for success.
  const sql = `\\set ON_ERROR_STOP on\n\\set VERBOSITY verbose\nset role ${role};\n${statement}\n`;
  const cmd = new Deno.Command(PSQL_BIN, {
    args: ['-h', '127.0.0.1', '-p', PG_PORT, '-U', 'postgres', '-d', TEST_DB, '-X', '-q', '-At'],
    stdin: 'piped', stdout: 'piped', stderr: 'piped',
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(sql));
  await writer.close();
  const { code, stdout, stderr } = await child.output();
  const err = new TextDecoder().decode(stderr);
  if (code === 0) return { ok: true, out: new TextDecoder().decode(stdout) };
  const m = err.match(/ERROR:\s+(\w{5}): ([^\n]*)/);
  return { ok: false, code: m?.[1] ?? 'XX000', message: m?.[2] ?? 'database error' };
}

// Routes outbound calls: Turnstile is answered here; RPCs run in the database; anything else is refused.
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://challenges.cloudflare.com/')) {
    const params = new URLSearchParams(String(init?.body ?? ''));
    return Response.json({ success: params.get('response') === 'good-token' });
  }
  if (url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`)) {
    const headers = new Headers(init?.headers);
    const apikey = headers.get('apikey') ?? '';
    const role = apikey === SERVICE_KEY ? 'service_role' : apikey === ANON_KEY ? 'anon' : 'unknown';
    const fn = url.slice(`${SUPABASE_URL}/rest/v1/rpc/`.length);
    rpcCalls.push({ fn, role, apikey: apikey === SERVICE_KEY ? 'service' : apikey === ANON_KEY ? 'anon' : 'other' });
    if (role === 'unknown') return Response.json({ code: '42501', message: 'invalid api key' }, { status: 401 });
    const args = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const named = Object.entries(args).map(([k, v]) => `${k} => ${sqlLiteral(v)}`).join(', ');
    const isBoolean = fn === 'web_consume_client_limit';
    const statement = isBoolean ? `select public.${fn}(${named});` : `select public.${fn}(${named});`;
    const result = await runSql(role, statement);
    if (!result.ok) return Response.json({ code: result.code, message: result.message }, { status: 400 });
    if (isBoolean) return Response.json(result.out.trim().split('\n').pop() === 't');
    return Response.json(null);
  }
  throw new Error(`unexpected outbound call in gate test: ${url}`);
}) as typeof fetch;

function inquiryRequest(token: string, ip: string, message = 'Edge path test'): Request {
  return new Request('https://site.example/functions/website-inquiry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://site.example', 'cf-connecting-ip': ip },
    body: JSON.stringify({
      kind: 'contact', name: 'Gate Test', email: 'gate@example.org', phone: '', message, topic: 'General inquiry',
      consentVersion: 'v1', consentTextHash: 'a'.repeat(64), honeypot: '', turnstileToken: token,
    }),
  });
}

function resetCalls() {
  rpcCalls.length = 0;
}

async function storedMessages(message: string): Promise<number> {
  const r = await runSql('postgres', `select count(*) from public.web_inbound_submissions where message = ${sqlLiteral(message)};`);
  if (!r.ok) throw new Error(`count failed: ${r.message}`);
  return Number(r.out.trim().split('\n').pop());
}

Deno.test('1. a request without a valid Turnstile token is refused and never reaches the database', async () => {
  resetCalls();
  const res = await serve(inquiryRequest('bad-token', '203.0.113.10'));
  if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  if (rpcCalls.length !== 0) throw new Error(`expected no database calls, got ${JSON.stringify(rpcCalls)}`);
});

Deno.test('2. a verified request is stored through the service role only', async () => {
  resetCalls();
  const before = await storedMessages('Edge path test verified');
  const res = await serve(inquiryRequest('good-token', '203.0.113.20', 'Edge path test verified'));
  if (res.status !== 202) throw new Error(`expected 202, got ${res.status}: ${await res.text()}`);
  const fns = rpcCalls.map((c) => `${c.fn}:${c.role}`);
  if (JSON.stringify(fns) !== JSON.stringify(['web_consume_client_limit:service_role', 'web_submit_inquiry:service_role'])) {
    throw new Error(`unexpected database calls: ${JSON.stringify(fns)}`);
  }
  const after = await storedMessages('Edge path test verified');
  if (after !== before + 1) throw new Error(`expected one stored row, before=${before} after=${after}`);
});

Deno.test('3. a direct database call made with the public key is refused', async () => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/web_submit_inquiry`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_kind: 'contact', p_name: 'Direct', p_email: 'direct@example.org', p_phone: '', p_message: 'Direct anon call',
      p_topic: 'General inquiry', p_consent_version: 'v1', p_consent_text_hash: 'a'.repeat(64), p_honeypot: '',
    }),
  });
  if (res.status === 200 || res.status === 202) throw new Error(`direct anon call was accepted: ${res.status}`);
  const body = (await res.json()) as { code?: string };
  if (body.code !== '42501') throw new Error(`expected permission code 42501, got ${JSON.stringify(body)}`);
  const stored = await storedMessages('Direct anon call');
  if (stored !== 0) throw new Error(`direct call stored ${stored} row(s)`);
});

Deno.test('4. the per-client limit holds: the sixth verified request from one address is refused', async () => {
  const ip = '198.51.100.44';
  for (let i = 1; i <= 5; i++) {
    const res = await serve(inquiryRequest('good-token', ip, `Limit test ${i}`));
    if (res.status !== 202) throw new Error(`request ${i}: expected 202, got ${res.status}`);
  }
  const sixth = await serve(inquiryRequest('good-token', ip, 'Limit test 6'));
  if (sixth.status !== 429) throw new Error(`request 6: expected 429, got ${sixth.status}`);
  if ((await storedMessages('Limit test 6')) !== 0) throw new Error('the refused request was stored');
});

Deno.test('5. missing configuration fails closed with an unavailable message, never a success', async () => {
  const saved = Deno.env.get('TURNSTILE_SECRET_KEY');
  Deno.env.delete('TURNSTILE_SECRET_KEY');
  try {
    resetCalls();
    const res = await serve(inquiryRequest('good-token', '203.0.113.90'));
    if (res.status !== 503) throw new Error(`expected 503, got ${res.status}`);
    if (rpcCalls.length !== 0) throw new Error('database was called with missing configuration');
  } finally {
    if (saved !== undefined) Deno.env.set('TURNSTILE_SECRET_KEY', saved);
  }
});

