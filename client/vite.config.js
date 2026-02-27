import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration.
 *
 * In dev mode, the Vite dev server proxies all /api requests to the
 * Express backend on port 3001, so CORS is never an issue during
 * development. Production builds output to dist/ and are served
 * statically by Express.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
