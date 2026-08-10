/**
 * Platform ingress API — front door HTTP entry (design §6 / §9).
 *
 * POST /v1/events  → validate → event_outbox → orchestration.ingress
 *
 * Start worker first (`npm start` in repo root), then:
 *   npm run start -w @tekisho/api
 */
import Fastify from "fastify";
import * as PgBossModule from "pg-boss";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { acceptPlatformEvent } from "@tekisho/orchestrator/src/ingress/accept-platform-event.js";
import { INGRESS_QUEUE } from "@tekisho/orchestrator/src/routing/table.js";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATOR_URL is required");
}

const port = Number(process.env.API_PORT ?? 4100);

async function main(): Promise<void> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  const boss = new PgBossModule.PgBoss({
    connectionString: databaseUrl,
    schema: "pgboss",
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  await boss.start();
  await boss.createQueue(INGRESS_QUEUE);

  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  app.post("/v1/events", async (req, reply) => {
    try {
      const result = await acceptPlatformEvent(req.body, {
        pool,
        enqueue: async (queue, data) => boss.send(queue, data),
      });
      return reply.code(result.inserted ? 202 : 200).send({
        status: result.inserted ? "accepted" : "duplicate",
        event_id: result.event_id,
        queue: result.queue,
      });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return reply.code(400).send({ error: "invalid_envelope", details: err.issues });
      }
      req.log.error(err);
      return reply.code(500).send({
        error: "ingress_failed",
        message: err?.message ?? String(err),
      });
    }
  });

  const shutdown = async () => {
    await app.close();
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Ingress API listening on :${port} (POST /v1/events)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
