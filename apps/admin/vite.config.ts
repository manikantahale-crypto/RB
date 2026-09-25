import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["mermaid"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    /**
     * Fail rather than drift.
     *
     * Without this, a 5173 already in use sends vite quietly to 5174 — and the
     * admin then runs on a port nobody is looking at, proxying to an admin-api
     * that may be a different process than the one being edited. A stack that
     * half-works is harder to diagnose than one that refuses to start.
     */
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.ADMIN_API_URL || `http://127.0.0.1:${process.env.ADMIN_API_PORT || 4200}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
