import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone public site. It imports nothing from the private Hub under ../src.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
