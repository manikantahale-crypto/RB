/**
 * The one HTTP call every RELAY adapter makes.
 *
 * RELAY is its own process (`apps/relay`, :3005), not node-api. The base URL
 * is read the way node-api's own relay.adapter.js reads it, so one setting
 * points everything at the same RELAY. Its dev stub is `ORCH_STUB_RELAY`.
 */
import { classifyModuleError, modulePoster, type ModuleResponse } from '../module-http.js';

export type RelayResponse = ModuleResponse;

export const postRelay = modulePoster(
  'Relay',
  () =>
    (
      process.env.RELAY_INTERNAL_URL ||
      process.env.RELAY_SERVICE_URL ||
      process.env.RELAY_API_URL ||
      'http://127.0.0.1:3005'
    ).replace(/\/$/, ''),
  { stubEnv: 'ORCH_STUB_RELAY' },
);

export const classifyRelayError = classifyModuleError;
