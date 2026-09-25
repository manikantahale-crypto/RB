import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: {
      clientPort: 3000
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || process.env.GATEWAY_URL || `http://127.0.0.1:${process.env.GATEWAY_PORT || 8080}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});
