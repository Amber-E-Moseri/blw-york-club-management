// Local server for the unified build. Applies vercel.json the same way as scripts/unified-routing.mjs, so browser tests
// exercise the real routing rules (redirects, SPA fallbacks, headers) without a Vercel account.
//   PORT=3100 node scripts/serve-unified.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { resolveRequest } from './unified-routing.mjs';

const root = process.cwd();
const outDir = join(root, 'dist');
const port = Number(process.env.PORT ?? 3100);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.map': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const result = resolveRequest({ root, outDir, path: url.pathname + url.search });
  const headers = { ...result.headers };
  if (result.kind === 'redirect') {
    res.writeHead(result.status, { ...headers, Location: result.location + url.search });
    return res.end();
  }
  if (result.kind === 'file') {
    const body = readFileSync(result.file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(result.file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
  res.end(result.kind === 'function' ? 'Serverless function not available in the local emulator' : 'Not found');
}).listen(port, () => console.log(`Unified build at http://localhost:${port} (public /, Hub /hub, admin /admin)`));
