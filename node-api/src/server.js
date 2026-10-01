console.log(`[${new Date().toISOString()}] [node-api] module loading started`);
const app = require("./app");
const env = require("./config/env");
const { pool } = require("./config/db");
const log = require("./utils/logger");
const { withPgRetry } = require("./utils/pgRetry");
const { startBoss, stopBoss } = require("./config/queue");
const { seedEventSchemas } = require("./repositories/outbox.repository");
const { ensureSchema: ensureRecruiterReviewSchema } = require("./modules/syntra/repositories/recruiterReview.repository");
const { registerJdUploadedWorker } = require("./modules/syntra/workers/jdUploaded.worker");
const {
  registerResumeUploadedWorker,
} = require("./modules/syntra/workers/resumeUploaded.worker");
const { registerActivationWorkers } = require("./modules/syntra/workers/activation.worker");
const {
  registerMatchRequestedWorker,
} = require("./modules/syntra/workers/matchRequested.worker");
const {
  registerAstraRequirementReceivedWorker,
} = require("./modules/astra/workers/astraRequirementReceived.worker");
const {
  registerAstraEmailPollerWorker,
} = require("./modules/astra/workers/astraEmailPoller.worker");
const {
  registerConsentAutoResendWorker,
} = require("./modules/prism/workers/consentAutoResend.worker");
console.log(`[${new Date().toISOString()}] [node-api] imports loaded`);

let server = null;
let isShuttingDown = false;
let bossInstance = null;

async function bootstrapPgBossWorkers() {
  const boss = await withPgRetry("syntra-api pg-boss", () => startBoss());
  bossInstance = boss;

  await withPgRetry("syntra-api pg-boss workers", async () => {
    await registerJdUploadedWorker(boss);
    await registerResumeUploadedWorker(boss);
    await registerMatchRequestedWorker(boss);
    await registerActivationWorkers(boss);
    await registerAstraRequirementReceivedWorker(boss);
    await registerAstraEmailPollerWorker(boss);
    await registerConsentAutoResendWorker(boss);
    const { registerRelayWorkers } = require("../../apps/relay/src/jobs/worker");
    await registerRelayWorkers(boss, log);
  });
  log.info("pg-boss workers registered successfully");

  if (env.IMAP_POLL_ENABLED) {
    const minutes = Math.max(1, Math.floor(env.IMAP_POLL_INTERVAL_SECONDS / 60));
    const cron = `*/${minutes} * * * *`;
    log.info(`[IMAP Scheduler] Scheduling periodic poll: every ${minutes}m (${cron})`);
    await withPgRetry("syntra-api imap schedule", () =>
      boss.schedule("astra.email.poll", cron, {}),
    );
  } else {
    log.info("[IMAP Scheduler] Poller is disabled in environment. Unscheduling.");
    try {
      await boss.unschedule("astra.email.poll");
    } catch (err) {
      log.warn(`[IMAP Scheduler] Failed to unschedule: ${err.message}`);
    }
  }
}

async function start() {
  console.log(`[${new Date().toISOString()}] [node-api] [1/3] Starting node-api bootstrap (target port: ${env.PORT})...`);

  try {
    await withPgRetry("syntra-api postgres", async () => {
      const t0 = Date.now();
      console.log(`[${new Date().toISOString()}] [node-api] [1/3] Connecting to PostgreSQL (timeout: 10s)...`);

      let timerId;
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error("Postgres connection timed out after 10000ms")), 10000);
      });
      const queryPromise = pool.query("SELECT now() AS now, current_database() AS db");

      const { rows } = await Promise.race([queryPromise, timeoutPromise]).finally(() => {
        if (timerId) clearTimeout(timerId);
      });
      console.log(
        `[${new Date().toISOString()}] [node-api] [1/3] Postgres connected in ${Date.now() - t0}ms (db: ${rows[0].db}, server time: ${rows[0].now})`,
      );

      const t1 = Date.now();
      console.log(`[${new Date().toISOString()}] [node-api] [2/3] Checking event catalogue (authoring.event_catalog)...`);
      await seedEventSchemas();
      console.log(`[${new Date().toISOString()}] [node-api] [2/3] Event catalogue verified in ${Date.now() - t1}ms`);

      const t2 = Date.now();
      console.log(`[${new Date().toISOString()}] [node-api] [3/3] Verifying review queue schema (syntra.review_queue)...`);
      await ensureRecruiterReviewSchema();
      console.log(`[${new Date().toISOString()}] [node-api] [3/3] Review queue schema verified in ${Date.now() - t2}ms`);
    });
    console.log(
      `[${new Date().toISOString()}] [node-api] Platform event catalogue checked (read-only). [platformEvents=${env.PLATFORM_EVENTS_ENABLED}, delegateMatch=${env.ORCH_DELEGATE_MATCH}, emitJdReceived=${env.ORCH_EMIT_JD_RECEIVED}]`,
    );
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [node-api] [FATAL] Database initialization failed:`, err?.stack || err);
    process.exit(1);
  }

  // Listen first so wait-on /health succeeds even if pg-boss is waiting on a DB slot.
  console.log(`[${new Date().toISOString()}] [node-api] Binding HTTP listener to http://127.0.0.1:${env.PORT}...`);
  server = app.listen(env.PORT, "127.0.0.1", () => {
    console.log(`[${new Date().toISOString()}] [node-api] HTTP server listening on http://127.0.0.1:${env.PORT}`);
    setImmediate(() => {
      console.log(`[${new Date().toISOString()}] [node-api] Loading Relay routes...`);
      const tRelay = Date.now();
      try {
        app.loadRelayRoutes();
        console.log(`[${new Date().toISOString()}] [node-api] Relay routes loaded in ${Date.now() - tRelay}ms`);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] [node-api] Failed to load Relay routes:`, err?.stack || err);
      }
    });
  });

  bootstrapPgBossWorkers().catch((err) => {
    log.error(`[pg-boss] background bootstrap failed (API still up on :${env.PORT}):`, err.message);
    log.error(
      "[pg-boss] If EMAXCONN: stop other dev processes, wait 30s, restart. " +
        "Start terminal 1 (npm run dev) before terminal 2 (dev:orch-admin).",
    );
  });
}


async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`${signal} received — shutting down`);

  if (server) {
    log.info("Closing HTTP server to stop accepting new requests...");
    // Close idle keep-alive connections so the server doesn't hang indefinitely
    if (server.closeIdleConnections) {
      server.closeIdleConnections();
    }
    // Wait for in-flight requests to finish
    await new Promise((resolve) => server.close(resolve));
    log.info("HTTP server closed. All active requests finished.");
  }

  try {
    await stopBoss();
  } catch (err) {
    log.error("pg-boss stop failed:", err.message);
  }

  try {
    await pool.end();
    log.info("Postgres pool closed.");
  } catch {
    /* ignore */
  }

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
// Handle nodemon restarts gracefully
process.once("SIGUSR2", () => shutdown("SIGUSR2"));

start().catch((err) => {
  log.error("Startup crashed");
  log.error(err);
  process.exit(1);
});
