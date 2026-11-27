/* eslint-disable no-console */
/**
 * Test servers for the production build. Dependency-free Node, used by playwright.production.config.ts and by the
 * production-build spec.
 *
 *  - static: serves PROD_BUILD_DIR with SPA fallback to index.html, and logs the bundle hash it is serving, so a run can
 *    prove which candidate is under test.
 *  - auth:   a local stand-in for the Supabase auth endpoint. It drops the password request at the socket, which is a
 *    real network failure in the browser. It never reaches an external host, so no test password leaves the machine.
 *
 * Run directly: `node e2e/support/buildServers.cjs static` or `... auth`.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Serves `root` on 127.0.0.1. `overrides` maps a URL path to a Buffer served in place of the file.
 *
 * Test control: PUT /__test__/override?path=/sw.js sets an override from the request body, and
 * DELETE /__test__/override?path=/sw.js removes it. The upgrade test uses this to serve the legacy worker at /sw.js only
 * while it seeds a device, so the candidate's own /sw.js is served afterwards.
 */
function startStaticServer({ root, port, overrides = new Map() }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__test__/override') {
      const target = url.searchParams.get('path');
      if (!target || !target.startsWith('/')) {
        res.writeHead(400).end('path required');
        return;
      }
      if (req.method === 'PUT') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          overrides.set(target, Buffer.concat(chunks));
          res.writeHead(204).end();
        });
        return;
      }
      if (req.method === 'DELETE') {
        overrides.delete(target);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (overrides.has(pathname)) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(pathname)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(overrides.get(pathname));
      return;
    }
    const safe = path.normalize(path.join(root, pathname));
    if (!safe.startsWith(path.normalize(root))) {
      res.writeHead(403).end();
      return;
    }
    let file = safe;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Unknown extension-less routes are the SPA, not a missing asset.
      if (path.extname(pathname)) {
        res.writeHead(404).end('not found');
        return;
      }
      file = path.join(root, 'index.html');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** The local stand-in for the auth endpoint. CORS is open to the test origin only. */
function startFakeAuthServer({ port, allowOrigin }) {
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/auth/v1/token')) {
      // A real network failure: the connection closes before any response.
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end('{}');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** Hash of the main bundle the static server is about to serve. Lets a run prove which build it tested. */
function servedBundleFingerprint(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const match = html.match(/src="(\/static\/js\/main\.[^"]+\.js)"/);
  if (!match) throw new Error('index.html does not reference a main bundle');
  const file = path.join(root, match[1]);
  return { bundle: path.basename(match[1]), sha256: sha256(fs.readFileSync(file)) };
}

module.exports = { startStaticServer, startFakeAuthServer, servedBundleFingerprint, sha256 };

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === 'static') {
    const root = process.env.PROD_BUILD_DIR;
    const port = Number(process.env.PROD_PORT || 4173);
    if (!root || !fs.existsSync(path.join(root, 'index.html'))) {
      console.error(`PROD_BUILD_DIR is not a build: ${root}`);
      process.exit(1);
    }
    const fingerprint = servedBundleFingerprint(root);
    startStaticServer({ root, port }).then(() => {
      console.log(`[static] serving ${root} on 127.0.0.1:${port} bundle=${fingerprint.bundle} sha256=${fingerprint.sha256}`);
    });
  } else if (mode === 'auth') {
    const port = Number(process.env.PROD_AUTH_PORT || 4174);
    const allowOrigin = process.env.PROD_ORIGIN || 'http://127.0.0.1:4173';
    startFakeAuthServer({ port, allowOrigin }).then(() => {
      console.log(`[auth] fake auth endpoint on 127.0.0.1:${port}`);
    });
  } else {
    console.error('usage: node e2e/support/buildServers.cjs static|auth');
    process.exit(1);
  }
}
