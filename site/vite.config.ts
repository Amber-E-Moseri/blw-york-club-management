import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Only a production deployment on Vercel may be indexed. Every other build (preview, local dev, CI) is marked
// noindex. Vercel sets VERCEL_ENV at build time. Read it without @types/node, which this app does not install.
const vercelEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VERCEL_ENV;
const isProductionBuild = vercelEnv === 'production';

function noindexUnlessProduction(): Plugin {
  return {
    name: 'noindex-unless-production',
    transformIndexHtml(html) {
      if (isProductionBuild) return html;
      return html.replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>');
    },
  };
}

// Standalone public site. It imports nothing from the private Hub under ../src.
export default defineConfig({
  plugins: [react(), noindexUnlessProduction()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
