// Assembles the single deployable dist/ for the unified BLW York platform.
//   dist/                 public website (site/, Vite, base "/")
//   dist/hub/             Hub (CRA, homepage "/hub"), including its service worker and manifest
// Run from the repository root after `npm run build:site` and `npm run build:hub`.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const siteOut = join(root, 'site', 'dist');
const hubOut = join(root, 'build');
const dist = join(root, 'dist');

for (const [label, dir] of [['site build', siteOut], ['hub build', hubOut]]) {
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(`Missing ${label} output at ${dir}. Run npm run build:site and npm run build:hub first.`);
  }
}

rmSync(dist, { recursive: true, force: true });
cpSync(siteOut, dist, { recursive: true });
cpSync(hubOut, join(dist, 'hub'), { recursive: true });

// The Hub's own build output must never overwrite a public file, and vice versa.
for (const required of ['index.html', 'service-worker.js', 'assets']) {
  if (!existsSync(join(dist, required))) throw new Error(`dist/${required} missing after assembly`);
}
for (const required of ['hub/index.html', 'hub/service-worker.js', 'hub/manifest.json', 'hub/static']) {
  if (!existsSync(join(dist, required))) throw new Error(`dist/${required} missing after assembly`);
}
console.log('Unified build assembled at dist/: public website at /, Hub at /hub.');
