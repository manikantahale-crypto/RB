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
  planForEvent,
} from "@tekisho/orchestrator/src/routing/table.js";
import { startOutboxRelay } from "./workers/outbox-relay.worker.js";
import { startIngressRouter } from "./workers/ingress-router.worker.js";
import { startModuleWorkers } from "./workers/module-execute.worker.js";
import { startResumeThreadWorker } from "./workers/resume-thread.worker.js";
import { handlePlatformDispatchEvent } from "./workers/dispatch-handlers.js";
import { ensureJobPinTable } from "./version-pin.js";
import { ensureIngressEventSchemas } from "./ensure-event-schemas.js";
import { ensureFailedWorkflowsTable } from "@tekisho/orchestrator/src/workflow/failed-workflows.js";
import { runWorkflowWithOrgContext } from "./run-with-org.js";

const SYNTRA_TEST_ORG_ID = "2b8e12b3-1745-4ae9-902c-5a249c28ba94";
/** Off by default — Syntra already owns jd/resume/match queues; dual consumers exhaust Supabase pool. */
const ENABLE_SYNTRA_BRIDGE = process.env.ENABLE_SYNTRA_BRIDGE === "1";

const databaseUrl = new URL(env.DATABASE_MIGRATOR_URL);

console.log("Database connection target:", {
  username: decodeURIComponent(databaseUrl.username),
  passwordLength: decodeURIComponent(databaseUrl.password).length,
  hostname: databaseUrl.hostname,
  port: databaseUrl.port,
  database: databaseUrl.pathname,
});

async function bootstrapPgBoss(): Promise<void> {
  console.log(
    "Starting pg-boss bootstrap (ingress + router + modules" +
      (ENABLE_SYNTRA_BRIDGE ? " + Syntra bridge" : "") +
      ")...",
  );

  const boss = new PgBossModule.PgBoss({
    connectionString: env.DATABASE_MIGRATOR_URL,
    schema: "pgboss",
    ssl: { rejectUnauthorized: false },
    max: 1,
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
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
  });
  // Idle/dropped clients emit 'error' on Client; without this Node exits.
  pool.on("error", (error: Error) => {
    console.error("[Dispatcher] pg pool error:", error.message);
  });

  const checkpointer = new PostgresSaver(pool, undefined, {
    schema: "langgraph",
  });
  await checkpointer.setup();

  const compiler = new GraphCompiler(pool, checkpointer);
  await compiler.ensureSchemaAndSeed();
  await ensureFailedWorkflowsTable(pool);
  await ensureJobPinTable(pool);
  await ensureIngressEventSchemas(pool);
  const runner = new WorkflowRunner(compiler, pool);

  await startIngressRouter({ boss, compiler });
  await startModuleWorkers({ boss, pool, compiler, runner });
  await startResumeThreadWorker({ boss, runner });

  const stopOutboxRelay = await startOutboxRelay({
    boss,
    pool,
    resolvePin: async (eventType, organizationId) => {
      const plan = planForEvent(eventType);
      if (plan.kind !== "graph" || !plan.graphKey) return null;
      const graphVersion = await compiler.resolveActiveVersion(
        plan.graphKey,
        organizationId,
      );
      return { graphKey: plan.graphKey, graphVersion };
    },
  });

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
        const plan = planForEvent(envelope.event_type);

        if (plan.kind !== "graph") {
          await handlePlatformDispatchEvent({ boss, pool, envelope });
          continue;
        }

        const workflowName =
          envelope.__graphKey ??
          plan.graphKey ??
          resolver.tryResolve(envelope.event_type);
        if (!workflowName) {
          console.log(
            `[Dispatcher] no graph for ${envelope.event_type} — acking`,
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
          `[Dispatcher] Workflow ${result.graphKey}@${result.graphVersion} → ${result.status}`,
        );
      } catch (error) {
        console.error(`[Dispatcher] Error processing job ${job.id}:`, error);
        throw error;
      }
    }
  });

  if (ENABLE_SYNTRA_BRIDGE) {
    console.warn(
      "[Bootstrap] ENABLE_SYNTRA_BRIDGE=1 is DEPRECATED — dual consumers exhaust Supabase. " +
        "Prefer Syntra ORCH_API_URL → POST /v1/events. Bridge kept only for emergency debugging.",
    );
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
              `[Bridge] ${queue} → ${result.graphKey}@${result.graphVersion} ${result.status}`,
            );
          } catch (error) {
            console.error(`[Bridge] Error on ${queue} job ${job.id}:`, error);
            throw error;
          }
        }
      });
    }
  } else {
    console.log(
      "[Bootstrap] Syntra bridge OFF (retired default). Syntra should set ORCH_API_URL → POST /v1/events. " +
        "ENABLE_SYNTRA_BRIDGE=1 only for emergency dual-queue debugging.",
    );
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
