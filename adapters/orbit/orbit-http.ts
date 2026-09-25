/**
 * The one HTTP call every ORBIT adapter makes.
 *
 * ORBIT's routes (`/internal/orbit/*`) are served by the same `node-api`
 * process as SYNTRA's, so the base URL falls back to SYNTRA's. `ORBIT_API_URL`
 * exists so that stays a deployment choice rather than a rewrite.
 */
import { classifyModuleError, modulePoster, type ModuleResponse } from '../module-http.js';

export type OrbitResponse = ModuleResponse;

export const postOrbit = modulePoster(
  'Orbit',
  () => process.env.ORBIT_API_URL || process.env.SYNTRA_API_URL || `http://127.0.0.1:${process.env.SYNTRA_PORT || '4000'}`,
);

export const classifyOrbitError = classifyModuleError;
