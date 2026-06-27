import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: {
      // Native filesystem change events don't reliably propagate through
      // Docker Desktop's Windows bind mount -- without polling, Vite never
      // notices source edits and keeps serving a stale module graph.
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/incidents': 'http://localhost:8000',
      '/agent': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/pods': 'http://localhost:8000',
      '/certs': 'http://localhost:8000',
      '/jira': 'http://localhost:8000',
      '/drift': 'http://localhost:8000',
      '/orchestrator': 'http://localhost:8000',
      '/chat': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
