/**
 * Platform ingress API — front door HTTP entry (design §6 / §9).
 *
 * POST /v1/events  → validate → event_outbox → orchestration.ingress
 *
 * Start worker first (`npm start` in repo root), then:
 *   npm run start -w @tekisho/api
 */
import { sslFor, canonicalPoolOpts } from "@tekisho/authoring";
import Fastify from "fastify";
import * as PgBossModule from "pg-boss";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { acceptPlatformEvent } from "@tekisho/orchestrator/src/ingress/accept-platform-event.js";
import {
  INGRESS_QUEUE,
  RESUME_THREAD_QUEUE,
  MODULE_SEND_OPTIONS,
} from "@tekisho/orchestrator/src/routing/table.js";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATOR_URL is required");
}

const port = Number(process.env.API_PORT ?? 4100);

async function main(): Promise<void> {
  if (!databaseUrl) {
    throw new Error(
      "[Ingress API] DATABASE_URL is not set. Nothing can be read or written " +
        "without it, and a pool with no connection string fails later and less " +
        "clearly than this.",
    );
  }

  const pool = new pg.Pool(canonicalPoolOpts(databaseUrl, "ingress", { max: 2 }));
  pool.on("error", (error: Error) => {
    console.error("[Ingress API] pg pool error:", error.message);
  });

  const boss = new PgBossModule.PgBoss({
    connectionString: databaseUrl,
    schema: "pgboss",
    ssl: sslFor(databaseUrl),
    max: Math.max(1, parseInt(process.env.DB_BOSS_POOL_MAX || process.env.DEV_PG_POOL_MAX || "1", 10)),
    application_name: process.env.DB_APPLICATION_NAME || "tekisho-ingress-boss",
  });
  // Pool timeouts must not crash the process (same pattern as worker bootstrap).
  boss.on("error", (error: unknown) => {
    console.error("[Ingress API] pg-boss error:", error);
  });
  await boss.start();
  await boss.createQueue(INGRESS_QUEUE);
  await boss.createQueue(RESUME_THREAD_QUEUE);

  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  /**
   * Trace an ingress event: outbox siblings (same correlation_id) + agent_runs/steps.
   * GET /v1/trace/:eventId
   */
  app.get("/v1/trace/:eventId", async (req, reply) => {
    const { eventId } = req.params as { eventId: string };
    const { loadTraceByEventId } = await import(
      "@tekisho/orchestrator/src/workflow/agent-runs.js"
    );
    try {
      const trace = await loadTraceByEventId(pool, eventId);
      return reply.send({
        event_id: eventId,
        outbox_count: trace.outbox.length,
        runs_count: trace.runs.length,
        steps_count: trace.steps.length,
        ...trace,
      });
    } catch (err: any) {
      req.log.error(err);
      return reply.code(500).send({
        error: "trace_failed",
        message: err?.message ?? String(err),
      });
    }
  });

  app.post("/v1/events", async (req, reply) => {
    try {
      const result = await acceptPlatformEvent(req.body, { pool });
      req.log.info(
        { event_id: result.event_id, inserted: result.inserted },
        "ingress accepted (outbox; relay will publish)",
      );
      return reply.code(result.inserted ? 202 : 200).send({
        status: result.inserted ? "accepted" : "duplicate",
        event_id: result.event_id,
        queue: result.queue,
        next: "outbox-relay → orchestration.ingress|dispatch",
        trace: `/v1/trace/${result.event_id}`,
      });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return reply.code(422).send({ error: "invalid_envelope", details: err.issues });
      }
      req.log.error(err);
      return reply.code(500).send({
        error: "ingress_failed",
        message: err?.message ?? String(err),
      });
    }
  });

  /** Design §10 — replay pinned payload onto its module queue. */
  app.post("/v1/failed-workflows/:id/replay", async (req, reply) => {
    const { id } = req.params as { id: string };
    const {
      loadFailedWorkflowForReplay,
      markFailedWorkflowReplayed,
    } = await import(
      "@tekisho/orchestrator/src/workflow/failed-workflows.js"
    );

    const row = await loadFailedWorkflowForReplay(pool, id);
    if (!row) {
      return reply.code(404).send({ error: "not_found" });
    }
    await boss.createQueue(row.queue);
    await boss.send(row.queue, row.pinned_payload, {
      ...MODULE_SEND_OPTIONS,
      singletonKey: `${row.event_id}:replay:${Date.now()}`,
    });
    await markFailedWorkflowReplayed(pool, id);
    return reply.code(202).send({
      status: "replayed",
      id,
      queue: row.queue,
      thread_id: row.thread_id,
    });
  });

  /** Design §9.2 — resume a parked human.gate thread. */
  app.post("/v1/threads/resume", async (req, reply) => {
    const body = req.body as {
      thread_id?: string;
      graph_key?: string;
      graph_version?: number;
      organization_id?: string;
      decision?: unknown;
    };
    if (
      !body.thread_id ||
      !body.graph_key ||
      !body.organization_id
    ) {
      return reply.code(422).send({
        error: "invalid_body",
        required: ["thread_id", "graph_key", "organization_id"],
      });
    }
    await boss.send(RESUME_THREAD_QUEUE, {
      thread_id: body.thread_id,
      graph_key: body.graph_key,
      graph_version: body.graph_version,
      organization_id: body.organization_id,
      decision: body.decision ?? { approved: true },
    });
    return reply.code(202).send({
      status: "resume_enqueued",
      queue: RESUME_THREAD_QUEUE,
      thread_id: body.thread_id,
    });
  });

  const shutdown = async () => {
    await app.close();
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host: "127.0.0.1" });
  console.log(`Ingress API listening on :${port} (POST /v1/events)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
