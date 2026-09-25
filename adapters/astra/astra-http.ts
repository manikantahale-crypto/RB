/**
 * The one HTTP call every ASTRA adapter makes.
 *
 * ASTRA's routes (`/internal/astra/*`) are served by the same `node-api`
 * process as SYNTRA's, so the base URL falls back to SYNTRA's. `ASTRA_API_URL`
 * exists so that stays a deployment choice rather than a rewrite.
 */
import { classifyModuleError, modulePoster, type ModuleResponse } from '../module-http.js';

export type AstraResponse = ModuleResponse;

export const postAstra = modulePoster(
  'Astra',
  () => process.env.ASTRA_API_URL || process.env.SYNTRA_API_URL || `http://127.0.0.1:${process.env.SYNTRA_PORT || '4000'}`,
);

export const classifyAstraError = classifyModuleError;
