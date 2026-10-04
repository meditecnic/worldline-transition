import { defineConfig } from 'vite';

// Static, relative-path bundle so dist/ can be served from any sub-path.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
});
