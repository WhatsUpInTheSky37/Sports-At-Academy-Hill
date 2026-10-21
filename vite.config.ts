import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The dev entry page lives in web/ so the repository root can hold a committed production build
// (index.html + assets/) that GitHub Pages can serve straight from the branch.
export default defineConfig({
  root: 'web',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  server: { host: true, port: 5173 },
  test: {
    root: fileURLToPath(new URL('./', import.meta.url)),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
