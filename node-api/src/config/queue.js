const { PgBoss } = require("pg-boss");
const { sslFor } = require("./ssl");
const env = require("./env");
const log = require("../utils/logger");
const { withPgRetry } = require("../utils/pgRetry");

const QUEUES = [
  "jd.uploaded",
  "resume.uploaded",
  "match.requested",
  // Facts, published when entities are activated in bulk. SYNTRA answers them
  // by re-running its funnel; see modules/syntra/workers/activation.worker.
  "job.activated",
  "candidate.activated",
  "module.astra.requirement",
  "astra.requirement.normalized",
  "astra.email.poll",
  // PRISM: the hourly sweep that re-sends unanswered consent requests
  // (modules/prism/workers/consentAutoResend.worker). pg-boss 12 refuses to
  // work a queue nobody created; on the old project this one existed because
  // something else had created it first.
  "prism.consent.autoresend",
];

let boss = null;

async function startBoss() {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    ssl: sslFor(env.DATABASE_URL),
    // Session pooler allows ~15 clients total — share budget with Node + Python pools
    max: 1,
    connectionTimeoutMillis: 20000,
  });

  boss.on("error", (err) => {
    log.error("[pg-boss] error:", err.message);
  });

  await withPgRetry("pg-boss start", async () => {
    await boss.start();
    for (const name of QUEUES) {
      await boss.createQueue(name);
    }
  });

  log.info(`[pg-boss] started; queues: ${QUEUES.join(", ")}`);
  return boss;
}

function getBoss() {
  if (!boss) {
    throw new Error("pg-boss not started — call startBoss() first");
  }
  return boss;
}

async function stopBoss() {
  if (!boss) return;
  await boss.stop({ graceful: true, timeout: 10000 });
  boss = null;
  log.info("[pg-boss] stopped");
}

module.exports = { startBoss, getBoss, stopBoss, QUEUES };
