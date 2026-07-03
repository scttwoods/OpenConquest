import { defineConfig } from 'vite';

// The dev server proxies /ws and /health to the Fastify server (server/index.ts),
// which runs alongside Vite via `npm run dev`. In production Fastify serves the
// built client itself, so no proxy exists there.
export default defineConfig({
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/health': { target: 'http://localhost:8080' },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
