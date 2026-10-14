// postgrest_stub.mjs
// A small PostgREST-compatible HTTP server backed by an in-process PGlite replay. It is a test double for the Supabase
// REST and auth endpoints, used so the real Edge Function (run under Deno with the real supabase-js client) can call a
// database that enforces real grants, RLS and functions. It does not replicate PostgREST's full grammar: it supports the
// subset the dispatch function uses (select, eq, in, single, insert, update, rpc, auth user).
//
// Role resolution: a request bearing the service-role key runs as service_role (bypasses RLS, as in Supabase). A request
// bearing a user id as its bearer token runs as authenticated for that user. Every query runs under SET ROLE, so grants
// and function EXECUTE privileges are enforced by PostgreSQL.
import http from 'node:http';

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function startPostgrestStub({ db, serviceKey, port = 0 }) {
  let chain = Promise.resolve();
  // One statement at a time: the stub shares a single in-process database.
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  async function asSql(role, uid, sql, params = []) {
    return serial(async () => {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','',false);`);
      try {
        // role null: internal lookup run as the owner (the auth schema is not exposed to API roles).
        if (role) await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claim.role', '${role}', false);`);
        const r = await db.query(sql, params);
        return { ok: true, rows: r.rows };
      } catch (e) {
        return { ok: false, code: e.code, message: e.message, detail: e.detail ?? null };
      } finally {
        await db.exec('reset role').catch(() => {});
      }
    });
  }

  const json = (res, status, body, extraHeaders = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const pgError = (res, r) => {
    if (r.code === '42883') return json(res, 404, { code: 'PGRST202', message: r.message, details: null, hint: null });
    if (r.code === '42P01' || r.code === '42703') return json(res, 400, { code: r.code, message: r.message, details: r.detail, hint: null });
    const status = r.code === '42501' ? 403 : r.code === '23514' || r.code === '23505' || r.code === '23503' || r.code === '23502' || r.code === '22023' ? 400 : 400;
    return json(res, status, { code: r.code ?? 'P0001', message: r.message, details: r.detail, hint: null });
  };

  function identify(req) {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const apikey = req.headers.apikey ?? '';
    // A user JWT in the bearer header wins: supabase-js sends the service key as `apikey` on every request.
    if (bearer === serviceKey) return { role: 'service_role', uid: null };
    // Test tokens are unsigned JWTs (alg none) carrying the user id in `sub`. The stub does not verify signatures;
    // this is a limitation of the test double, not of the function under test.
    const parts = bearer.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (/^[0-9a-f-]{36}$/.test(payload.sub ?? '') && payload.exp > Date.now() / 1000) return { role: 'authenticated', uid: payload.sub };
      } catch { /* fall through */ }
    }
    return { role: 'anon', uid: null };
  }

  function parseFilters(url) {
    const clauses = [];
    const params = [];
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'columns'].includes(k)) continue;
      if (!IDENT.test(k)) throw new Error(`bad column ${k}`);
      const dot = v.indexOf('.');
      const op = v.slice(0, dot);
      const val = v.slice(dot + 1);
      params.push(op === 'in' ? `{${val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).join(',')}}` : val);
      const p = `$${params.length}`;
      if (op === 'eq') clauses.push(`"${k}"::text = ${p}::text`);
      else if (op === 'neq') clauses.push(`"${k}"::text <> ${p}::text`);
      else if (op === 'in') clauses.push(`"${k}"::text = any(${p}::text[])`);
      else if (op === 'is') clauses.push(`"${k}" is ${val === 'null' ? 'null' : 'not null'}`), params.pop();
      else throw new Error(`unsupported operator ${op}`);
    }
    return { where: clauses.length ? ` where ${clauses.join(' and ')}` : '', params };
  }

  function selectList(url) {
    const s = url.searchParams.get('select') ?? '*';
    if (s === '*') return '*';
    return s.split(',').map((c) => {
      const name = c.trim();
      if (!IDENT.test(name)) throw new Error(`bad select ${name}`);
      return `"${name}"`;
    }).join(', ');
  }

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://stub');
    const { role, uid } = identify(req);
    const data = body ? JSON.parse(body) : undefined;

    try {
      // Auth: GET /auth/v1/user with a user token.
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        if (!uid) return json(res, 401, { message: 'invalid JWT' });
        const r = await asSql(null, null, `select id::text as id, email, aud from auth.users where id = $1`, [uid]);
        if (!r.ok || r.rows.length === 0) return json(res, 401, { message: 'invalid JWT' });
        return json(res, 200, { id: r.rows[0].id, email: r.rows[0].email, aud: r.rows[0].aud, role: 'authenticated' });
      }

      // RPC: POST /rest/v1/rpc/<name> with named arguments.
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/);
      if (rpc && req.method === 'POST') {
        const args = Object.keys(data ?? {});
        if (!args.every((a) => IDENT.test(a))) return json(res, 400, { code: 'PGRST100', message: 'bad argument name' });
        const named = args.map((a, i) => `${a} := $${i + 1}`).join(', ');
        const sql = `select * from public.${rpc[1]}(${named})`;
        const r = await asSql(role, uid, sql, args.map((a) => data[a]));
        if (!r.ok) return pgError(res, r);
        const scalar = r.rows.length === 1 && Object.keys(r.rows[0]).length === 1 && Object.keys(r.rows[0])[0] === rpc[1];
        return json(res, 200, scalar ? Object.values(r.rows[0])[0] : r.rows);
      }

      // Table: GET (select), POST (insert), PATCH (update).
      const tbl = url.pathname.match(/^\/rest\/v1\/([a-z_][a-z0-9_]*)$/);
      if (tbl) {
        const table = tbl[1];
        if (req.method === 'GET') {
          const f = parseFilters(url);
          const limit = url.searchParams.get('limit') ? ` limit ${Number(url.searchParams.get('limit'))}` : '';
          const r = await asSql(role, uid, `select ${selectList(url)} from public."${table}"${f.where}${limit}`, f.params);
          if (!r.ok) return pgError(res, r);
          if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
            if (r.rows.length !== 1) return json(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${r.rows.length} rows`, hint: null });
            return json(res, 200, r.rows[0]);
          }
          return json(res, 200, r.rows);
        }
        if (req.method === 'POST') {
          const rows = Array.isArray(data) ? data : [data];
          const cols = Object.keys(rows[0] ?? {});
          if (!cols.every((c) => IDENT.test(c))) return json(res, 400, { code: 'PGRST100', message: 'bad column' });
          const values = [];
          const tuples = rows.map((row) => `(${cols.map((c) => { values.push(row[c]); return `$${values.length}`; }).join(', ')})`);
          const ret = (req.headers.prefer ?? '').includes('return=representation') ? ' returning *' : '';
          const r = await asSql(role, uid, `insert into public."${table}" (${cols.map((c) => `"${c}"`).join(', ')}) values ${tuples.join(', ')}${ret}`, values);
          if (!r.ok) return pgError(res, r);
          return json(res, 201, ret ? r.rows : undefined);
        }
        if (req.method === 'PATCH') {
          const f = parseFilters(url);
          const cols = Object.keys(data ?? {});
          if (!cols.every((c) => IDENT.test(c))) return json(res, 400, { code: 'PGRST100', message: 'bad column' });
          const offset = f.params.length;
          const set = cols.map((c, i) => `"${c}" = $${offset + i + 1}`).join(', ');
          const where = f.where.replace(/\$(\d+)/g, (_m, n) => `$${n}`);
          const r = await asSql(role, uid, `update public."${table}" set ${set}${where}`, [...f.params, ...cols.map((c) => data[c])]);
          if (!r.ok) return pgError(res, r);
          return json(res, 204);
        }
      }
      return json(res, 404, { code: 'PGRST000', message: `no route ${req.method} ${url.pathname}` });
    } catch (e) {
      return json(res, 400, { code: 'STUB', message: e.message });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}
