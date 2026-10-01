/**
 * Centralized API & environment configuration for the Frontend application.
 *
 * Preferred:
 *   VITE_API_BASE_URL
 *
 * Backward-compatible fallback:
 *   VITE_API_URL
 *
 * Local development fallback:
 *   http://localhost:4000
 *
 * The frontend communicates with the Syntra API on port 4000.
 */

const configuredUrl: string | undefined =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_API_URL as string | undefined);

if (!configuredUrl && !import.meta.env.DEV) {
  console.error(
    '[FATAL CONFIG ERROR] VITE_API_BASE_URL is not configured in this production build.\n' +
    'The frontend cannot communicate with the backend.\n' +
    'Please configure VITE_API_BASE_URL in your Vercel Project Settings (e.g., https://your-backend-gateway.onrender.com).'
  );
}

const rawApiUrl: string =
  configuredUrl ||
  (import.meta.env.DEV ? 'http://localhost:4000' : '');

export const API_BASE_URL: string = rawApiUrl.replace(/\/$/, '');