import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/incidents': 'http://localhost:8080',
      '/agent': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
      '/pods': 'http://localhost:8080',
      '/certs': 'http://localhost:8080',
      '/jira': 'http://localhost:8080',
      '/drift': 'http://localhost:8080',
      '/orchestrator': 'http://localhost:8080',
      '/chat': 'http://localhost:8080',
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
