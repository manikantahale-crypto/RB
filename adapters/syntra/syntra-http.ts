/**
 * The one HTTP call every SYNTRA adapter makes.
 *
 * The call itself is `adapters/module-http.ts`, shared with ASTRA and ORBIT;
 * this file is SYNTRA's name and base URL. The exports keep their old names
 * so the nine SYNTRA nodes did not change when the call moved.
 */
import { classifyModuleError, modulePoster, type ModuleResponse } from '../module-http.js';

export type SyntraResponse = ModuleResponse;

export const postSyntra = modulePoster(
  'Syntra',
  () => process.env.SYNTRA_API_URL || `http://127.0.0.1:${process.env.SYNTRA_PORT || '4000'}`,
);

export const classifySyntraError = classifyModuleError;
