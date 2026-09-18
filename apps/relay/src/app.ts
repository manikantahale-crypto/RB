/**
 * RELAY (the Smart Inbox) as its own process.
 *
 * On the old project this app was embedded inside node-api on an ephemeral
 * port (node-api/src/relay/embedRelay.js, compiled in-process with tsx). Here
 * it runs on its own, on a fixed port, like every other service in
 * `npm run dev:all`; node-api reaches it through RELAY_API_URL and proxies
 * the Front's /threads calls to it (node-api/src/modules/relay/routes).
 *
 *   npm run dev -w relay            (RELAY_PORT, default 3005)
 */
import { startRelay } from './bootstrap';

const port = parseInt(process.env.RELAY_PORT || '3005', 10);
const host = process.env.RELAY_HOST || '127.0.0.1';

startRelay({ port, host }).catch((err) => {
  console.error('[relay] failed to start:', err);
  process.exit(1);
});
