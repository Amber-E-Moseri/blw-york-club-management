import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { applyIndexingDirective, indexingDirective } from './src/lib/indexing';

// Standalone public site. It imports nothing from the private Hub under ../src.
// Unified platform: the public website is served at the domain root (/). The repository-root build copies this app's
// dist/ to the root of the deployment, and the Hub is copied beside it at /hub. Base '/' keeps asset paths root-relative.

// Read without @types/node, which this app does not install. Vercel injects its variables into the build environment.
const buildEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

// Every built and dev page gets an explicit robots directive. Pages are indexable only for an approved production build
// connected to the backend. See src/lib/indexing.ts for the rule.
function indexingPolicy(): Plugin {
  return {
    name: 'public-site-indexing',
    transformIndexHtml(html) {
      const directive = indexingDirective({
        vercelEnv: buildEnv.VERCEL_ENV,
        approved: buildEnv.SITE_INDEXING_APPROVED,
        supabaseUrl: buildEnv.VITE_SUPABASE_URL,
        supabaseAnonKey: buildEnv.VITE_SUPABASE_ANON_KEY,
        previewDemo: buildEnv.VITE_PREVIEW_DEMO,
      });
      return applyIndexingDirective(html, directive);
    },
  };
}

export default defineConfig({
  plugins: [react(), indexingPolicy()],
  base: '/',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
