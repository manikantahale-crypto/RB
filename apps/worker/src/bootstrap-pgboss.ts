import * as PgBossModule from "pg-boss";
import { env } from "./env.js";
import pg from 'pg';
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { SimpleRunbookResolver } from "@tekisho/orchestrator/src/resolver/runbook.js";
import { WorkflowRunner } from "@tekisho/orchestrator/src/workflow/runner.js";
import { GraphCompiler } from "@tekisho/orchestrator/src/graphs/compiler.js";
import { EVENT_TYPES } from "@tekisho/domain";
import type { EventEnvelope } from "@tekisho/domain";
import type { EventInput } from "@tekisho/orchestrator/src/types.js";
import { v4 as uuidv4 } from "uuid";
import { startOutboxRelay } from "./workers/outbox-relay.worker.js";

// Syntra publishes jd.uploaded with a minimal payload { jobId }. The orchestrator
// runbook keys off syntra.jd.received, so we translate the queue name and
// synthesize the envelope fields Syntra doesn't send. Org id must exist in
// public.organizations (Test Org) so the final event_outbox write doesn't fail.
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
  console.log("Starting pg-boss bootstrap & dispatcher...");

  // Supabase session-mode pooler caps clients at pool_size (often 15). Keep
  // boss + app pool tiny; relay reuses `pool` (no third Pool).
  const boss = new PgBossModule.PgBoss({
    connectionString: env.DATABASE_MIGRATOR_URL,
    schema: "pgboss",
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  // Transient pooler errors (EMAXCONNSESSION) must not crash the process.
  boss.on("error", (error: unknown) => {
    console.error("[Dispatcher] pg-boss error:", error);
  });

  await boss.start();
  console.log("pg-boss tables created successfully");

  // event.type → graph_key (design §9.1 routing table, simplified)
  const resolver = new SimpleRunbookResolver({
    [EVENT_TYPES.JD_RECEIVED]: 'syntra.jd.workflow',
    [EVENT_TYPES.RESUME_RECEIVED]: 'syntra.resume.workflow',
    'syntra.match.requested': 'syntra.match.workflow'
  });

  // Pool for compiler + outbox writes + checkpointer + relay — keep small.
  const pool = new pg.Pool({
    connectionString: env.DATABASE_MIGRATOR_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  // Same Postgres as bootstrap-checkpointer.ts; schema option instead of search_path
  // so this pool can still query public.graph_definitions / event_outbox.
  const checkpointer = new PostgresSaver(pool, undefined, { schema: "langgraph" });
  await checkpointer.setup();

  // Topology from DB (graph_definitions); behavior from node registry.
  const compiler = new GraphCompiler(pool, checkpointer);
  await compiler.ensureSchemaAndSeed();
  const runner = new WorkflowRunner(compiler, pool);

  // Outbox relay after checkpointer: shares boss + migrator pool.
  const stopOutboxRelay = await startOutboxRelay({ boss, pool });

  console.log("Listening for orchestration.dispatch events...");
  await boss.createQueue("orchestration.dispatch");
  
  await boss.work("orchestration.dispatch", async (jobs: any) => {
    for (const job of jobs) {
      const envelope = job.data as EventEnvelope;
      
      console.log(`[Dispatcher] Received event: ${envelope.event_type} (ID: ${envelope.event_id})`);

      try {
        const workflowName = resolver.tryResolve(envelope.event_type);
        if (!workflowName) {
          console.log(
            `[Dispatcher] terminal event ${envelope.event_type} — no runbook, acking`
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
          payload: envelope.payload_ref
        };

        const pinnedVersion = job.data.__graphVersion
          ?? await compiler.resolveActiveVersion(workflowName, eventInput.organization_id);
        const result = await runner.executeWorkflow(
          workflowName,
          eventInput,
          String(job.id),
          pinnedVersion
        );
        
        if (result.status === 'FAILED') {
          console.error(`[Dispatcher] Workflow failed: ${result.error}`);
          throw new Error(result.error);
        }
        
        console.log(`[Dispatcher] Workflow ${workflowName} completed successfully.`);
      } catch (error) {
        console.error(`[Dispatcher] Error processing job ${job.id}:`, error);
        throw error; // Let pg-boss handle retry/dlq
      }
    }
  });

  // Map each Syntra queue to its runbook event type + how to extract ids.
  const SYNTRA_QUEUES = [
    { queue: "jd.uploaded",      eventType: EVENT_TYPES.JD_RECEIVED },
    { queue: "resume.uploaded",  eventType: EVENT_TYPES.RESUME_RECEIVED },
    { queue: "match.requested",  eventType: "syntra.match.requested" },
  ];

  for (const { queue, eventType } of SYNTRA_QUEUES) {
    await boss.createQueue(queue);
    await boss.work(queue, async (jobs: any) => {
      for (const job of jobs) {
        console.log(`[Dispatcher] Received ${queue}:`, job.data);
        try {
          const eventInput: EventInput = {
            event_id: uuidv4(),
            event_type: eventType,
            aggregate_id: job.data.jobId || job.data.resumeId || uuidv4(),
            aggregate_type: "requirement",
            organization_id: SYNTRA_TEST_ORG_ID,
            correlation_id: uuidv4(),
            payload: job.data,   // pass Syntra's payload straight through
          };
          const workflowName = resolver.resolve(eventInput.event_type, {
            organization_id: eventInput.organization_id,
            payload: eventInput.payload,
          });
          const pinnedVersion = job.data.__graphVersion
            ?? await compiler.resolveActiveVersion(workflowName, eventInput.organization_id);
          const result = await runner.executeWorkflow(
            workflowName,
            eventInput,
            String(job.id),
            pinnedVersion
          );
          if (result.status === "FAILED") throw new Error(result.error);
          console.log(`[Dispatcher] ${queue} → ${workflowName} completed.`, result.finalState);
          if (result.events.length) {
            console.log(`[Dispatcher] emitted ${result.events.length} event(s):`,
              result.events.map((e) => ({ type: e.event_type, payload: e.payload })));
          }
        } catch (error) {
          console.error(`[Dispatcher] Error on ${queue} job ${job.id}:`, error);
          throw error;
        }
      }
    });
  }

  // Graceful shutdown handling
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