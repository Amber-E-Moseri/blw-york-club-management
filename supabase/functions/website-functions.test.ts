// Runtime tests for the four website Edge Functions. Each function runs as a real child process (deno run) and is
// called over HTTP. Its upstream (Supabase REST, Auth and Storage) is replaced by an in-process stub that records every
// call, so the tests check what the function sends and how it answers, without a database and without production.
//
// Not covered here (needs the live Cloudflare siteverify endpoint): a successful Turnstile check on website-inquiry.
// Run from supabase/functions:   deno test -A website-functions.test.ts
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

const FN_DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SERVICE_KEY = 'service-key-for-tests-only-0000000000000000';
const ANON_KEY = 'anon-key-for-tests-only-111111111111111111';
const PEPPER = 'pepper-for-tests-only-0123456789abcdef0123456789';
const ORIGIN = 'https://www.example.org';
const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const EDITION_OK = '11111111-2222-4333-8444-555555555555';
const EDITION_NONE = '66666666-7777-4888-8999-aaaaaaaaaaaa';

type Call = { method: string; path: string; auth: string; body: string };
const calls: Call[] = [];
let limitAllowed = true;
let referencedObjects = new Set<string>();

// ----- upstream stub ------------------------------------------------------------------------------------------------
const stub = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async (req) => {
  const url = new URL(req.url);
  const body = req.method === 'GET' || req.method === 'DELETE' ? '' : await req.text();
  calls.push({ method: req.method, path: url.pathname, auth: req.headers.get('authorization') ?? '', body });
  const json = (status: number, v: unknown) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const p = url.pathname;
  if (p === '/siteverify') {
    // Turnstile stand-in: succeeds only for the test token, and records the address it was given.
    const params = new URLSearchParams(body);
    return json(200, { success: params.get('response') === 'good-token' });
  }
  if (p === '/auth/v1/user') {
    return req.headers.get('authorization') === 'Bearer user-ok' ? json(200, { id: USER_ID }) : json(401, { msg: 'bad' });
  }
  if (p === '/rest/v1/rpc/web_media_upload_allowed') {
    const auth = req.headers.get('authorization');
    if (auth === 'Bearer user-expired') return json(401, { code: 'PGRST301' });
    return json(200, auth === 'Bearer user-ok');
  }
  if (p === '/rest/v1/rpc/web_consume_client_limit') return json(200, limitAllowed);
  if (p === '/rest/v1/rpc/web_submit_inquiry') return json(202, null);
  if (p === '/rest/v1/rpc/web_resolve_edition_pdf') {
    const { p_edition_id } = JSON.parse(body) as { p_edition_id: string };
    return json(200, p_edition_id === EDITION_OK ? [{ storage_bucket: 'rhapsody-pdfs', storage_path: '2026/11/doc.pdf' }] : []);
  }
  if (p === '/rest/v1/rpc/web_record_download') return json(200, null);
  if (p.startsWith('/storage/v1/object/sign/rhapsody-pdfs/')) {
    return json(200, { signedURL: `/object/${p.slice('/storage/v1/object/'.length)}?token=tok-abc` });
  }
  if (p.startsWith('/storage/v1/object/upload/sign/')) {
    return json(200, { url: `/object/${p.slice('/storage/v1/object/'.length)}?token=up-abc` });
  }
  if (p === '/rest/v1/rpc/web_orphaned_uploads') {
    return json(200, [
      { bucket_id: 'site-media', object_name: 'orphan-a.jpg' },
      { bucket_id: 'avatars', object_name: 'not-ours.png' },
      { bucket_id: 'site-media', object_name: 'referenced.jpg' },
    ]);
  }
  if (p === '/rest/v1/rpc/web_upload_still_unreferenced') {
    const { p_object_name } = JSON.parse(body) as { p_object_name: string };
    return json(200, !referencedObjects.has(p_object_name));
  }
  if (req.method === 'DELETE' && p.startsWith('/storage/v1/object/')) return json(200, {});
  return json(404, { message: `stub has no route for ${req.method} ${p}` });
});
const STUB_URL = `http://127.0.0.1:${(stub.addr as Deno.NetAddr).port}`;

// ----- function runner ----------------------------------------------------------------------------------------------
let nextPort = 19400;

async function withFunction(
  name: string,
  env: Record<string, string>,
  run: (base: string) => Promise<void>,
) {
  const port = nextPort++;
  const base = `http://127.0.0.1:${port}`;
  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', `${FN_DIR}${name}/index.ts`],
    env: {
      DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`,
      SUPABASE_URL: STUB_URL,
      SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      WEBSITE_ALLOWED_ORIGINS: ORIGIN,
      ...env,
    },
    stdout: 'null',
    stderr: 'piped',
  }).spawn();
  try {
    // Wait for the child to listen (any HTTP answer counts).
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        await fetch(base, { method: 'OPTIONS' });
        up = true;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert(up, `${name} did not start`);
    await run(base);
  } finally {
    child.kill();
    await child.status;
  }
}

function resetCalls() {
  calls.length = 0;
}

const INQUIRY_ENV = {
  TURNSTILE_SECRET_KEY: 'ts-secret-test',
  CLIENT_HASH_SECRET: PEPPER,
  TURNSTILE_SITEVERIFY_URL: `${STUB_URL}/siteverify`,
};
const validInquiry = {
  kind: 'contact', name: 'Test Person', email: 'person@example.com', phone: '', message: 'Hi',
  topic: '', consentVersion: '1', consentTextHash: 'b'.repeat(64), honeypot: '', turnstileToken: 'good-token',
};

// ===== website-inquiry ==============================================================================================
Deno.test('website-inquiry: refuses non-POST and answers preflight for an allowed origin only', async () => {
  await withFunction('website-inquiry', INQUIRY_ENV, async (base) => {
    const get = await fetch(base, { method: 'GET' });
    assertEquals(get.status, 405);
    await get.text();
    const pre = await fetch(base, { method: 'OPTIONS', headers: { origin: ORIGIN } });
    assertEquals(pre.status, 204);
    assertEquals(pre.headers.get('access-control-allow-origin'), ORIGIN);
    await pre.body?.cancel();
    const other = await fetch(base, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assertEquals(other.headers.get('access-control-allow-origin'), null);
    await other.body?.cancel();
  });
});

Deno.test('website-inquiry: missing secrets fail closed with a 503 and no success', async () => {
  await withFunction('website-inquiry', { ...INQUIRY_ENV, TURNSTILE_SECRET_KEY: '' }, async (base) => {
    const res = await fetch(base, {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify(validInquiry),
    });
    assertEquals(res.status, 503);
    const text = await res.text();
    assertEquals(text.includes('received'), false);
  });
});

Deno.test('website-inquiry: a short CLIENT_HASH_SECRET is a configuration error', async () => {
  await withFunction('website-inquiry', { ...INQUIRY_ENV, CLIENT_HASH_SECRET: 'too-short' }, async (base) => {
    const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: '{}' });
    assertEquals(res.status, 503);
    await res.body?.cancel();
  });
});

Deno.test('website-inquiry: malformed and over-privileged bodies are refused before any upstream call', async () => {
  await withFunction('website-inquiry', INQUIRY_ENV, async (base) => {
    resetCalls();
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' };
    const notJson = await fetch(base, { method: 'POST', headers, body: '{not json' });
    assertEquals(notJson.status, 400);
    await notJson.body?.cancel();
    const extra = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ ...validInquiry, role: 'admin' }) });
    assertEquals(extra.status, 400);
    await extra.body?.cancel();
    const badKind = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ ...validInquiry, kind: 'admin' }) });
    assertEquals(badKind.status, 400);
    await badKind.body?.cancel();
    assertEquals(calls.length, 0, 'no upstream call for refused requests');
  });
});

Deno.test('website-inquiry: an unverified x-forwarded-for does not reach the per-client limiter', async () => {
  await withFunction('website-inquiry', INQUIRY_ENV, async (base) => {
    resetCalls();
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.77' },
      body: JSON.stringify(validInquiry),
    });
    assertEquals(res.status, 202, 'accepted on Turnstile and the database rules alone');
    await res.body?.cancel();
    assertEquals(calls.some((c) => c.path.endsWith('web_consume_client_limit')), false, 'no per-client limit without a trusted proxy');
    assertEquals(calls.some((c) => c.path.endsWith('web_submit_inquiry')), true);
    const verify = calls.find((c) => c.path === '/siteverify');
    assertEquals(new URLSearchParams(verify?.body ?? '').has('remoteip'), false, 'untrusted address is not sent to Turnstile');
  });
});

Deno.test('website-inquiry: behind a trusted Cloudflare proxy the per-client limit applies', async () => {
  await withFunction('website-inquiry', { ...INQUIRY_ENV, WEBSITE_TRUSTED_PROXY: 'cloudflare' }, async (base) => {
    resetCalls();
    limitAllowed = false;
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' },
        body: JSON.stringify(validInquiry),
      });
      assertEquals(res.status, 429);
      await res.body?.cancel();
      const limit = calls.find((c) => c.path.endsWith('web_consume_client_limit'));
      assert(limit, 'limiter consulted');
      assertEquals(JSON.parse(limit.body).p_client_hash.includes('203.0.113.9'), false, 'raw address never sent');
      assertEquals(calls.some((c) => c.path.endsWith('web_submit_inquiry')), false, 'refused before the database accepts');
    } finally {
      limitAllowed = true;
    }
  });
});

Deno.test('website-inquiry: a failed Turnstile check is refused before any database call', async () => {
  await withFunction('website-inquiry', INQUIRY_ENV, async (base) => {
    resetCalls();
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ ...validInquiry, turnstileToken: 'bad-token' }),
    });
    assertEquals(res.status, 403);
    await res.body?.cancel();
    assertEquals(calls.some((c) => c.path.startsWith('/rest/v1/rpc/')), false);
  });
});

// ===== website-media-upload =========================================================================================
const UPLOAD_ENV = {};
const upload = (base: string, token: string | null, body: unknown) =>
  fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

Deno.test('website-media-upload: refuses anonymous, anon-key and service-key callers', async () => {
  await withFunction('website-media-upload', UPLOAD_ENV, async (base) => {
    const body = { bucket: 'site-media', mime: 'image/png', bytes: 100 };
    const none = await upload(base, null, body);
    assertEquals(none.status, 401);
    await none.body?.cancel();
    const anon = await upload(base, ANON_KEY, body);
    assertEquals(anon.status, 401);
    await anon.body?.cancel();
    const svc = await upload(base, SERVICE_KEY, body);
    assertEquals(svc.status, 401);
    await svc.body?.cancel();
  });
});

Deno.test('website-media-upload: validates bucket, type and size before asking the database', async () => {
  await withFunction('website-media-upload', UPLOAD_ENV, async (base) => {
    resetCalls();
    for (const bad of [
      { bucket: 'site-media', mime: 'application/pdf', bytes: 10 },
      { bucket: 'site-media', mime: 'image/png', bytes: 5 * 1024 * 1024 + 1 },
      { bucket: 'public', mime: 'image/png', bytes: 10 },
    ]) {
      const res = await upload(base, 'user-ok', bad);
      assertEquals(res.status, 400);
      await res.body?.cancel();
    }
    assertEquals(calls.filter((c) => c.path.includes('web_media_upload_allowed')).length, 0);
  });
});

Deno.test('website-media-upload: a user without permission gets 403 and no signed URL', async () => {
  await withFunction('website-media-upload', UPLOAD_ENV, async (base) => {
    resetCalls();
    const res = await upload(base, 'user-denied', { bucket: 'site-media', mime: 'image/png', bytes: 100 });
    assertEquals(res.status, 403);
    await res.body?.cancel();
    assertEquals(calls.some((c) => c.path.includes('/storage/v1/object/upload/sign/')), false);
  });
});

Deno.test('website-media-upload: an expired session is reported as expired', async () => {
  await withFunction('website-media-upload', UPLOAD_ENV, async (base) => {
    const res = await upload(base, 'user-expired', { bucket: 'site-media', mime: 'image/png', bytes: 100 });
    assertEquals(res.status, 401);
    await res.body?.cancel();
  });
});

Deno.test('website-media-upload: an allowed user gets a signed URL under their own id, never the original name', async () => {
  await withFunction('website-media-upload', UPLOAD_ENV, async (base) => {
    resetCalls();
    const res = await upload(base, 'user-ok', { bucket: 'site-media', mime: 'image/jpeg', bytes: 2048 });
    assertEquals(res.status, 200);
    const out = (await res.json()) as { bucket: string; path: string; uploadUrl: string };
    assertEquals(out.bucket, 'site-media');
    assert(out.path.startsWith(`${USER_ID}/`), `path must start with the uploader id, got ${out.path}`);
    assertMatch(out.path, /^[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    assertMatch(out.uploadUrl, /\/storage\/v1\/object\/upload\/sign\/site-media\/.+\?token=up-abc$/);
    const signCall = calls.find((c) => c.path.includes('/storage/v1/object/upload/sign/'));
    assertEquals(signCall?.auth, `Bearer ${SERVICE_KEY}`, 'signing uses the service role, not the user');
  });
});

// ===== website-media-cleanup ========================================================================================
Deno.test('website-media-cleanup: requires the exact service-role bearer', async () => {
  await withFunction('website-media-cleanup', {}, async (base) => {
    const none = await fetch(base, { method: 'POST' });
    assertEquals(none.status, 401);
    await none.body?.cancel();
    const user = await fetch(base, { method: 'POST', headers: { authorization: 'Bearer user-ok' } });
    assertEquals(user.status, 401);
    await user.body?.cancel();
    const get = await fetch(base, { method: 'GET' });
    assertEquals(get.status, 405);
    await get.body?.cancel();
  });
});

Deno.test('website-media-cleanup: deletes only orphans in the two website buckets, and rechecks each one', async () => {
  await withFunction('website-media-cleanup', {}, async (base) => {
    resetCalls();
    referencedObjects = new Set(['referenced.jpg']);
    const res = await fetch(base, { method: 'POST', headers: { authorization: `Bearer ${SERVICE_KEY}` } });
    assertEquals(res.status, 200);
    const out = (await res.json()) as { candidates: number; deleted: number; skipped: number; failed: number };
    assertEquals(out, { candidates: 3, deleted: 1, skipped: 1, failed: 1 });
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.path);
    assertEquals(deletes, ['/storage/v1/object/site-media/orphan-a.jpg']);
    referencedObjects = new Set();
  });
});

// ===== website-rhapsody-pdf =========================================================================================
const PDF_ENV = { CLIENT_HASH_SECRET: PEPPER };

Deno.test('website-rhapsody-pdf: a non-UUID edition is a plain 404 with no upstream call', async () => {
  await withFunction('website-rhapsody-pdf', PDF_ENV, async (base) => {
    resetCalls();
    const res = await fetch(`${base}/?edition=../../etc`, { headers: { 'cf-connecting-ip': '203.0.113.5' } });
    assertEquals(res.status, 404);
    await res.body?.cancel();
    assertEquals(calls.length, 0);
  });
});

Deno.test('website-rhapsody-pdf: an edition that does not resolve is a 404 and records nothing', async () => {
  await withFunction('website-rhapsody-pdf', PDF_ENV, async (base) => {
    resetCalls();
    const res = await fetch(`${base}/?edition=${EDITION_NONE}`, { headers: { 'cf-connecting-ip': '203.0.113.5' } });
    assertEquals(res.status, 404);
    await res.body?.cancel();
    assertEquals(calls.some((c) => c.path.endsWith('web_record_download')), false);
  });
});

Deno.test('website-rhapsody-pdf: a published edition is recorded, then redirected to a short signed link', async () => {
  await withFunction('website-rhapsody-pdf', PDF_ENV, async (base) => {
    resetCalls();
    limitAllowed = true;
    const res = await fetch(`${base}/?edition=${EDITION_OK}&src=email&utm_source=news&utm_campaign=2026_11`, {
      headers: { 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test-agent' },
      redirect: 'manual',
    });
    assertEquals(res.status, 302);
    assertMatch(res.headers.get('location') ?? '', /\/storage\/v1\/object\/sign\/rhapsody-pdfs\/2026\/11\/doc\.pdf\?token=tok-abc$/);
    assertEquals(res.headers.get('referrer-policy'), 'no-referrer');
    assertEquals(res.headers.get('cache-control'), 'no-store');
    await res.body?.cancel();
    const record = calls.find((c) => c.path.endsWith('web_record_download'));
    assert(record, 'download recorded');
    const sent = JSON.parse(record.body) as Record<string, string>;
    assertEquals(sent.p_source, 'email');
    assertEquals(sent.p_utm_campaign, '2026_11');
    assertMatch(sent.p_visitor_hash, /^[0-9a-f]{64}$/);
    assertEquals(sent.p_visitor_hash.includes('203.0.113.5'), false, 'the raw address is never sent');
  });
});

Deno.test('website-rhapsody-pdf: behind a trusted proxy the per-client download limit answers 429 without signing', async () => {
  await withFunction('website-rhapsody-pdf', { ...PDF_ENV, WEBSITE_TRUSTED_PROXY: 'cloudflare' }, async (base) => {
    resetCalls();
    limitAllowed = false;
    try {
      const res = await fetch(`${base}/?edition=${EDITION_OK}`, { headers: { 'cf-connecting-ip': '203.0.113.5' }, redirect: 'manual' });
      assertEquals(res.status, 429);
      await res.body?.cancel();
      assertEquals(calls.some((c) => c.path.includes('/storage/v1/object/sign/')), false);
    } finally {
      limitAllowed = true;
    }
  });
});
