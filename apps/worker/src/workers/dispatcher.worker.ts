import { Pool } from "pg";
import { PgBoss, Job } from "pg-boss";
import { env } from "../env.js";
import { fileURLToPath } from "node:url";
import { WorkflowRunner } from "../../../../packages/orchestrator/src/workflow/runner.js";
import { Registry } from "../../../../packages/orchestrator/src/workflow/registry.js";
import { DBRunbookResolver } from "../../../../packages/orchestrator/src/resolver.js";
import type { EventEnvelope } from "@tekisho/domain";

export const DISPATCH_QUEUE = "orchestration.dispatch";

export async function startDispatcherWorker(): Promise<() => Promise<void>> {
  const pool = new Pool({
    connectionString: env.DATABASE_MIGRATOR_URL,
    ssl: { rejectUnauthorized: false },
  });

  const boss = new PgBoss({
    connectionString: env.DATABASE_MIGRATOR_URL,
    schema: "pgboss",
    ssl: { rejectUnauthorized: false },
  });

  await boss.start();

  const resolver = new DBRunbookResolver(pool);
  const registry = new Registry();
  const runner = new WorkflowRunner(resolver, registry, pool);

  await boss.work<EventEnvelope>(DISPATCH_QUEUE, async ([job]) => {
    try {
      const envelope = job.data;
      if (!envelope || !envelope.event_type || !envelope.event_id) {
        throw new Error(`Invalid event envelope in job ${job.id}`);
      }

      console.log(`[dispatcher] Processing event ${envelope.event_id} (${envelope.event_type})`);

      const result = await runner.executeWorkflow({
        event_id: envelope.event_id,
        event_type: envelope.event_type,
        aggregate_id: envelope.aggregate.id,
        payload: envelope.payload_ref || {}
      });

      if (result.status === 'FAILED') {
        throw new Error(`Workflow execution failed: ${result.error}`);
      }
      
      console.log(`[dispatcher] Event ${envelope.event_id} COMPLETED`);
    } catch (error: any) {
      console.error(`[dispatcher] Error processing job ${job.id}:`, error);
      throw error;
    }
  });

  console.log(`Dispatcher worker started → queue "${DISPATCH_QUEUE}"`);

  return async () => {
    await boss.stop();
    await pool.end();
    console.log("Dispatcher worker stopped");
  };
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  startDispatcherWorker()
    .then((stop) => {
      const shutdown = () => void stop().then(() => process.exit(0));
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((error) => {
      console.error("Failed to start dispatcher:", error);
      process.exitCode = 1;
    });
}
