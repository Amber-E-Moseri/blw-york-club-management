// Route verification for the unified platform. Run after `npm run build` (it reads dist/ and vercel.json).
// Exits non-zero on the first failed expectation, so CI and release checks can rely on it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRequest, loadRouting } from './unified-routing.mjs';

const root = process.cwd();
const outDir = join(root, 'dist');
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
};

if (!existsSync(join(outDir, 'index.html')) || !existsSync(join(outDir, 'hub', 'index.html'))) {
  console.error('dist/ is missing. Run npm run build first.');
  process.exit(2);
}

const resolve = (path) => resolveRequest({ root, outDir, path });
const isPublic = (r) => r.kind === 'file' && r.file === join(outDir, 'index.html');
const isHub = (r) => r.kind === 'file' && r.file === join(outDir, 'hub', 'index.html');
const hubAsset = readdirSync(join(outDir, 'hub', 'static', 'js')).find((f) => f.endsWith('.js'));
const publicAsset = readdirSync(join(outDir, 'assets')).find((f) => f.endsWith('.js') && f.startsWith('index-'));

// ── Public website at the root, including SPA fallbacks for public pages ──
check('/ serves the public website', isPublic(resolve('/')));
for (const p of ['/about', '/events', '/events/some-event', '/rhapsody', '/blog/post', '/contact', '/new-here', '/no-such-public-page']) {
  check(`${p} serves the public SPA (not swallowed by the Hub)`, isPublic(resolve(p)));
}
check('public static asset served from dist/assets', resolve(`/assets/${publicAsset}`).kind === 'file');
check('public service worker is the legacy retirement worker', resolve('/service-worker.js').file === join(outDir, 'service-worker.js'));

// ── Hub under /hub ──
for (const p of ['/hub', '/hub/', '/hub/login', '/hub/events', '/hub/members', '/hub/reset-password', '/hub/meetings']) {
  check(`${p} serves the Hub shell`, isHub(resolve(p)));
}
check('Hub static asset resolves under /hub/static', resolve(`/hub/static/js/${hubAsset}`).kind === 'file');
check('Hub service worker at /hub/service-worker.js', resolve('/hub/service-worker.js').file === join(outDir, 'hub', 'service-worker.js'));
check('Hub manifest at /hub/manifest.json', resolve('/hub/manifest.json').file === join(outDir, 'hub', 'manifest.json'));
check('Hub logo at /hub/logo.png', resolve('/hub/logo.png').file === join(outDir, 'hub', 'logo.png'));

// ── Administration under /admin ──
for (const p of ['/admin', '/admin/pending', '/admin/roles', '/admin/website/pages', '/admin/contact-reports']) {
  check(`${p} serves the Hub shell (authorization enforced in the app and database)`, isHub(resolve(p)));
}

// ── Missing build assets must 404, never return the HTML shell (a stale tab would otherwise run HTML as a script) ──
check('missing Hub chunk returns not-found, not the Hub shell', resolve('/hub/static/js/missing-chunk.js').kind === 'not-found');
check('missing public asset returns not-found, not the public shell', resolve('/assets/missing-chunk.js').kind === 'not-found');

// ── API requests reach functions, never a page ──
check('/api/email-relay routes to a function', resolve('/api/email-relay').kind === 'function');

// ── Legacy Hub routes redirect into /hub ──
const legacy = ['members', 'cells', 'announcements', 'devotionals', 'profile', 'email-preferences', 'books', 'contacts', 'confessions', 'testimonies', 'meetings', 'messages', 'habits', 'growth', 'login', 'reset-password'];
for (const name of legacy) {
  const r = resolve(`/${name}`);
  check(`/${name} redirects to /hub/${name}`, r.kind === 'redirect' && r.location === `/hub/${name}` && r.status === 307, r.kind === 'redirect' ? `${r.status} ${r.location}` : r.kind);
}
// /events is deliberately NOT a legacy redirect: it is a public page. Hub events live at /hub/events.
check('/events remains the public events page', isPublic(resolve('/events')));

// ── Every legacy redirect target is a real Hub route in src/App.tsx ──
const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
const hubRoutes = new Set([...app.matchAll(/path="(\/hub[^"]*)"/g)].map((m) => m[1]));
for (const name of legacy.filter((n) => n !== 'login' && n !== 'reset-password')) {
  check(`redirect target /hub/${name} exists in src/App.tsx`, hubRoutes.has(`/hub/${name}`));
}

// ── Headers: noindex everywhere, CSP only on the public website ──
check('Hub responses are noindex', resolve('/hub/events').headers['X-Robots-Tag'] === 'noindex, nofollow');
check('Public responses are noindex until the approved launch', resolve('/').headers['X-Robots-Tag'] === 'noindex, nofollow');
check('Public responses carry the site Content-Security-Policy', String(resolve('/about').headers['Content-Security-Policy'] ?? '').includes("default-src 'self'"));
check('Hub responses do not carry the public CSP', !('Content-Security-Policy' in resolve('/hub/events').headers));
check('Administration responses do not carry the public CSP', !('Content-Security-Policy' in resolve('/admin/pending').headers));

const config = loadRouting(root);
check('vercel.json declares the dist output directory', config.outputDirectory === 'dist');

console.log(failures.length === 0 ? '\nAll route checks passed.' : `\n${failures.length} route check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
