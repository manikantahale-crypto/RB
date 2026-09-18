import dotenv from 'dotenv';
import { resolve, join } from 'node:path';
import Fastify from 'fastify';
import { initWorker, scheduleJob, boss } from './jobs/worker';
import { sweepSLA } from './followups/slaSweeper';
import { sweepConsentTimeouts } from './followups/consentTimeoutSweeper';
import { registerRelayRoutes, pullMailbox } from './buildRelayApp';

const rootEnv = join(resolve(__dirname, '..', '..', '..'), '.env');
dotenv.config({ path: rootEnv });

export type StartRelayOptions = {
  /** Fixed on this project (RELAY_PORT, default 3005); 0 would be an OS-assigned port. */
  port?: number;
  host?: string;
};

let startedUrl: string | null = null;

export function getRelayInternalUrl(): string | null {
  return startedUrl;
}

/** Start Smart Inbox worker + HTTP server. Returns base URL (e.g. http://127.0.0.1:51234). */
export async function startRelay(options: StartRelayOptions = {}): Promise<string> {
  if (startedUrl) return startedUrl;

  const app = Fastify({ logger: true });
  registerRelayRoutes(app);

  const port =
    options.port ??
    parseInt(process.env.RELAY_PORT || process.env.RELAY_INTERNAL_PORT || '3005', 10);
  const host = options.host ?? process.env.RELAY_HOST ?? '127.0.0.1';

  await app.listen({ port: Number.isFinite(port) ? port : 0, host });

  const addr = app.server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const loopbackHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  startedUrl = `http://${loopbackHost}:${actualPort}`;
  process.env.RELAY_INTERNAL_URL = startedUrl;

  app.log.info(`Smart Inbox relay listening on ${startedUrl} (public API via Syntra :4000)`);

  // Initialize background workers after HTTP is up so login is not starved for DB slots.
  const sweeperDelayMs = Math.max(5000, parseInt(process.env.RELAY_WORKER_DELAY_MS || '20000', 10));
  setTimeout(() => {
    initWorker()
      .then(async () => {
        try {
          await boss.createQueue('sla-sweeper');
        } catch {
          /* exists */
        }
        await scheduleJob('sla-sweeper', '*/30 * * * *');
        await boss.work('sla-sweeper', async (jobs: unknown) => {
          const batch = Array.isArray(jobs) ? jobs : [jobs];
          if (batch.length) await sweepSLA();
        });

        try {
          await boss.createQueue('consent-timeout-sweeper');
        } catch {
          /* exists */
        }
        await scheduleJob('consent-timeout-sweeper', '*/15 * * * *');
        await boss.work('consent-timeout-sweeper', async (jobs: unknown) => {
          const batch = Array.isArray(jobs) ? jobs : [jobs];
          if (batch.length) await sweepConsentTimeouts();
        });

        const imapOn = String(process.env.IMAP_POLL_ENABLED || '').toLowerCase() === 'true';
        if (imapOn) {
          try {
            await boss.createQueue('mailbox-sync');
          } catch {
            /* exists */
          }
          await scheduleJob('mailbox-sync', '*/10 * * * *');
          await boss.work('mailbox-sync', async (jobs: unknown) => {
            const batch = Array.isArray(jobs) ? jobs : [jobs];
            if (batch.length) {
              try {
                await pullMailbox(app.log);
              } catch (err) {
                app.log.warn({ err }, 'Scheduled mailbox sync failed');
              }
            }
          });
        } else {
          app.log.info('Scheduled mailbox-sync skipped (IMAP_POLL_ENABLED is not true) — use Refresh / fetch-now');
        }
      })
      .catch((err) => {
        app.log.warn({ err: err?.message || String(err) }, 'Background worker bootstrap warning (HTTP API active)');
      });
  }, sweeperDelayMs);

  const imapOn = String(process.env.IMAP_POLL_ENABLED || '').toLowerCase() === 'true';
  if (imapOn) {
    setTimeout(() => {
      pullMailbox(app.log)
        .then((r) => app.log.info({ inbox: r.inbox, sent: r.sent }, 'Startup mailbox sync complete'))
        .catch((err) => app.log.warn({ err }, 'Startup mailbox sync failed'));
    }, sweeperDelayMs + 3000);
  }

  return startedUrl;
}
