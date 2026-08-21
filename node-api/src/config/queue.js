const { PgBoss } = require("pg-boss");
const env = require("./env");
const log = require("../utils/logger");

const QUEUES = [
  "jd.uploaded",
  "resume.uploaded",
  "match.requested",
  "module.astra.requirement",
  "astra.requirement.normalized",
  "astra.email.poll",
];

let boss = null;

async function startBoss() {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    ssl: { rejectUnauthorized: false },
    // Session pooler allows ~15 clients total — share budget with Node + Python pools
    max: 2,
    connectionTimeoutMillis: 20000,
  });

  boss.on("error", (err) => {
    log.error("[pg-boss] error:", err.message);
  });

  await boss.start();

  for (const name of QUEUES) {
    await boss.createQueue(name);
  }

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
