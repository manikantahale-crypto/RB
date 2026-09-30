import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const target =
    env.VITE_API_BASE_URL ||
    env.VITE_API_URL ||
    env.GATEWAY_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.GATEWAY_URL ||
    `http://127.0.0.1:${env.GATEWAY_PORT || process.env.GATEWAY_PORT || 4000}`;

  return {
    envDir: '../',
    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: {
        clientPort: 3000
      },
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    }
  };
});