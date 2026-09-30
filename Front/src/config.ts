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

const rawApiUrl: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (import.meta.env.DEV ? 'http://localhost:4000' : '');

export const API_BASE_URL: string = rawApiUrl.replace(/\/$/, '');