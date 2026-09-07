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
} = require("./workers/astraRequirementReceived.worker");
const {
  registerAstraEmailPollerWorker,
} = require("./workers/astraEmailPoller.worker");

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
  log.info("Starting node-api…");

  try {
    await withPgRetry("syntra-api postgres", async () => {
      const { rows } = await pool.query(
        "SELECT now() AS now, current_database() AS db",
      );
      log.info("Postgres connected", {
        now: rows[0].now,
        database: rows[0].db,
      });

      await seedEventSchemas();
      await ensureRecruiterReviewSchema();
    });
    log.info("Platform event schemas verified/seeded.", {
      platformEvents: env.PLATFORM_EVENTS_ENABLED,
      delegateMatch: env.ORCH_DELEGATE_MATCH,
      emitJdReceived: env.ORCH_EMIT_JD_RECEIVED,
    });
  } catch (err) {
    log.error("Postgres connection FAILED");
    log.error(err);
    process.exit(1);
  }

  // Listen first so wait-on /health succeeds even if pg-boss is waiting on a DB slot.
  server = app.listen(env.PORT, () => {
    log.info(`HTTP server listening on http://localhost:${env.PORT}`);
  });

  bootstrapPgBossWorkers().catch((err) => {
    log.error("[pg-boss] background bootstrap failed (API still up on :4000):", err.message);
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
