/**
 * The one HTTP call every PRISM adapter makes.
 *
 * PRISM's routes (`/internal/prism/*`) are served by the same `node-api`
 * process as SYNTRA's, so the base URL falls back to SYNTRA's. `PRISM_API_URL`
 * exists so that stays a deployment choice rather than a rewrite.
 */
import { classifyModuleError, modulePoster, type ModuleResponse } from '../module-http.js';

export type PrismResponse = ModuleResponse;

export const postPrism = modulePoster(
  'Prism',
  () => process.env.PRISM_API_URL || process.env.SYNTRA_API_URL || `http://127.0.0.1:${process.env.SYNTRA_PORT || '4000'}`,
);

export const classifyPrismError = classifyModuleError;
