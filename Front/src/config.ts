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
 *   http://localhost:8080
 *
 * The frontend communicates through the Gateway rather than directly
 * connecting to Node API, Orchestrator, or Admin API ports.
 */

const rawApiUrl: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (import.meta.env.DEV ? 'http://localhost:8080' : '');

export const API_BASE_URL: string = rawApiUrl.replace(/\/$/, '');