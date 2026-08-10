import * as PgBossModule from "pg-boss";
import { env } from "./env.js";
import pg from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { SimpleRunbookResolver } from "@tekisho/orchestrator/src/resolver/runbook.js";
import { WorkflowRunner } from "@tekisho/orchestrator/src/workflow/runner.js";
import { GraphCompiler } from "@tekisho/orchestrator/src/graphs/compiler.js";
import { EVENT_TYPES } from "@tekisho/domain";
import type { EventEnvelope } from "@tekisho/domain";
import type { EventInput } from "@tekisho/orchestrator/src/types.js";
import { v4 as uuidv4 } from "uuid";
import {
  EVENT_TO_GRAPH,
  DISPATCH_QUEUE,
} from "@tekisho/orchestrator/src/routing/table.js";
import { startOutboxRelay } from "./workers/outbox-relay.worker.js";
import { startIngressRouter } from "./workers/ingress-router.worker.js";
import { startModuleWorkers } from "./workers/module-execute.worker.js";
import { ensureJobPinTable } from "./version-pin.js";
import { ensureIngressEventSchemas } from "./ensure-event-schemas.js";
import { runWorkflowWithOrgContext } from "./run-with-org.js";

// Syntra publishes jd.uploaded with a minimal payload { jobId }. Bridge path
// (not the design front door). Prefer POST /v1/events → orchestration.ingress.
const SYNTRA_TEST_ORG_ID = "2b8e12b3-1745-4ae9-902c-5a249c28ba94";

const databaseUrl = new URL(env.DATABASE_MIGRATOR_URL);

console.log("Database connection target:", {
  username: decodeURIComponent(databaseUrl.username),
  passwordLength: decodeURIComponent(databaseUrl.password).length,
  hostname: databaseUrl.hostname,
  port: databaseUrl.port,
  database: databaseUrl.pathname,
});

async function bootstrapPgBoss(): Promise<void> {
  console.log("Starting pg-boss bootstrap (ingress + router + modules + Syntra bridge)...");

  const boss = new PgBossModule.PgBoss({
    connectionString: env.DATABASE_MIGRATOR_URL,
    schema: "pgboss",
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  boss.on("error", (error: unknown) => {
    console.error("[Dispatcher] pg-boss error:", error);
  });

  await boss.start();
  console.log("pg-boss started (schema ready)");

  const resolver = new SimpleRunbookResolver(EVENT_TO_GRAPH);

  const pool = new pg.Pool({
    connectionString: env.DATABASE_MIGRATOR_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  const checkpointer = new PostgresSaver(pool, undefined, { schema: "langgraph" });
  await checkpointer.setup();

  const compiler = new GraphCompiler(pool, checkpointer);
  await compiler.ensureSchemaAndSeed();
  await ensureJobPinTable(pool);
  await ensureIngressEventSchemas(pool);
  const runner = new WorkflowRunner(compiler, pool);

  // --- Design front door: ingress → router → module.* ---
  await startIngressRouter({ boss, compiler });
  await startModuleWorkers({ boss, pool, compiler, runner });

  // Outbox relay: workflow-emitted events → orchestration.dispatch
  const stopOutboxRelay = await startOutboxRelay({
    boss,
    pool,
    resolvePin: async (eventType, organizationId) => {
      const graphKey = EVENT_TO_GRAPH[eventType];
      if (!graphKey) return null;
      const graphVersion = await compiler.resolveActiveVersion(
        graphKey,
        organizationId,
      );
      return { graphKey, graphVersion };
    },
  });

  // Dispatch: relay path (often terminal completion events)
  console.log(`Listening for ${DISPATCH_QUEUE} events...`);
  await boss.createQueue(DISPATCH_QUEUE);

  await boss.work(DISPATCH_QUEUE, async (jobs: any) => {
    for (const job of jobs) {
      const envelope = job.data as EventEnvelope & {
        __graphKey?: string;
        __graphVersion?: number;
      };

      console.log(
        `[Dispatcher] Received event: ${envelope.event_type} (ID: ${envelope.event_id})`,
      );

      try {
        const workflowName =
          envelope.__graphKey ?? resolver.tryResolve(envelope.event_type);
        if (!workflowName) {
          console.log(
            `[Dispatcher] terminal event ${envelope.event_type} — no runbook, acking`,
          );
          continue;
        }

        const eventInput: EventInput = {
          event_id: envelope.event_id,
          event_type: envelope.event_type,
          aggregate_id: envelope.aggregate.id,
          aggregate_type: envelope.aggregate.type,
          organization_id: envelope.organization_id,
          correlation_id: envelope.correlation_id,
          payload: envelope.payload_ref as Record<string, unknown>,
        };

        const result = await runWorkflowWithOrgContext({
          pool,
          compiler,
          runner,
          bossJobId: String(job.id),
          workflowName,
          event: eventInput,
          payloadPin: {
            graphKey: envelope.__graphKey,
            graphVersion: envelope.__graphVersion,
          },
        });

        if (result.status === "FAILED") {
          console.error(`[Dispatcher] Workflow failed: ${result.error}`);
          throw new Error(result.error);
        }

        console.log(
          `[Dispatcher] Workflow ${result.graphKey}@${result.graphVersion} completed successfully.`,
        );
      } catch (error) {
        console.error(`[Dispatcher] Error processing job ${job.id}:`, error);
        throw error;
      }
    }
  });

  // --- Syntra-direct bridge (side door) — keep until Syntra uses /v1/events ---
  const SYNTRA_QUEUES = [
    { queue: "jd.uploaded", eventType: EVENT_TYPES.JD_RECEIVED },
    { queue: "resume.uploaded", eventType: EVENT_TYPES.RESUME_RECEIVED },
    { queue: "match.requested", eventType: EVENT_TYPES.MATCH_REQUESTED },
  ];

  for (const { queue, eventType } of SYNTRA_QUEUES) {
    await boss.createQueue(queue);
    await boss.work(queue, async (jobs: any) => {
      for (const job of jobs) {
        console.log(`[Bridge] Received ${queue}:`, job.data);
        try {
          const eventInput: EventInput = {
            event_id: uuidv4(),
            event_type: eventType,
            aggregate_id: job.data.jobId || job.data.resumeId || uuidv4(),
            aggregate_type: "requirement",
            organization_id: SYNTRA_TEST_ORG_ID,
            correlation_id: uuidv4(),
            payload: job.data,
          };
          const workflowName = resolver.resolve(eventInput.event_type, {
            organization_id: eventInput.organization_id,
            payload: eventInput.payload,
          });
          const result = await runWorkflowWithOrgContext({
            pool,
            compiler,
            runner,
            bossJobId: String(job.id),
            workflowName,
            event: eventInput,
            payloadPin: {
              graphKey: job.data.__graphKey,
              graphVersion: job.data.__graphVersion,
            },
          });
          if (result.status === "FAILED") throw new Error(result.error);
          console.log(
            `[Bridge] ${queue} → ${result.graphKey}@${result.graphVersion} completed.`,
            result.finalState,
          );
          if (result.events.length) {
            console.log(
              `[Bridge] emitted ${result.events.length} event(s):`,
              result.events.map((e) => ({
                type: e.event_type,
                payload: e.payload,
              })),
            );
          }
        } catch (error) {
          console.error(`[Bridge] Error on ${queue} job ${job.id}:`, error);
          throw error;
        }
      }
    });
  }

  const shutdown = async () => {
    console.log("\nShutting down dispatcher...");
    await stopOutboxRelay();
    await boss.stop();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrapPgBoss().catch((error: unknown) => {
  console.error("pg-boss bootstrap failed:", error);
  process.exitCode = 1;
});
