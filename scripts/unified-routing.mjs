// Resolves a request path against the unified platform's vercel.json the way Vercel does:
//   1. redirects (exact legacy paths), 2. files in the build output, 3. rewrites (SPA fallbacks), 4. response headers.
// Shared by scripts/verify-unified-routes.mjs and scripts/serve-unified.mjs so the route check and the local server
// cannot drift apart.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

export function loadRouting(root) {
  return JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
}

const matches = (source, path) => new RegExp(`^${source}$`).exec(path);

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** Maps a URL path to a file inside the output directory, following Vercel's directory-index behaviour. */
export function fileFor(outDir, path) {
  const clean = decodeURIComponent(path.split('?')[0]);
  if (clean.includes('..')) return null;
  const candidate = normalize(join(outDir, clean));
  if (!candidate.startsWith(normalize(outDir) + sep) && candidate !== normalize(outDir)) return null;
  if (isFile(candidate)) return candidate;
  const index = join(candidate, 'index.html');
  if (existsSync(index) && statSync(candidate).isDirectory()) return index;
  return null;
}

/**
 * Returns { kind: 'redirect', status, location } | { kind: 'file', file, headers } | { kind: 'function', path } |
 * { kind: 'not-found', headers } for a request path.
 */
export function resolveRequest({ root, outDir, path }) {
  const config = loadRouting(root);
  const bare = path.split('?')[0];
  const headers = responseHeaders(config, bare);

  for (const r of config.redirects ?? []) {
    if (bare === r.source) {
      return { kind: 'redirect', status: r.permanent ? 308 : 307, location: r.destination, headers };
    }
  }

  const direct = fileFor(outDir, bare);
  if (direct) return { kind: 'file', file: direct, headers };

  for (const rw of config.rewrites ?? []) {
    const m = matches(rw.source, bare);
    if (!m) continue;
    const dest = rw.destination.replace(/\$(\d)/g, (_s, n) => m[Number(n)] ?? '');
    if (dest.startsWith('/api/')) return { kind: 'function', path: dest, headers };
    const file = fileFor(outDir, dest);
    return file ? { kind: 'file', file, headers } : { kind: 'not-found', headers };
  }
  return { kind: 'not-found', headers };
}

export function responseHeaders(config, path) {
  const out = {};
  for (const block of config.headers ?? []) {
    if (!matches(block.source, path)) continue;
    for (const h of block.headers) out[h.key] = h.value;
  }
  return out;
}
