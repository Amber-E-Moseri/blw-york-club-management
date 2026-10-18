import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone public site. It imports nothing from the private Hub under ../src.
// The site is served at /site/ on the Hub's domain: the Hub's vercel.json strips the /site prefix before the request
// reaches this project, so the built asset paths carry the /site/ base.
export default defineConfig({
  plugins: [react()],
  base: '/site/',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
