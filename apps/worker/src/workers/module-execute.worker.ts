import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { GraphCompiler } from "@tekisho/orchestrator/src/graphs/compiler.js";
import type { WorkflowRunner } from "@tekisho/orchestrator/src/workflow/runner.js";
import type { EventInput } from "@tekisho/orchestrator/src/types.js";
import { MODULE_QUEUES } from "@tekisho/orchestrator/src/routing/table.js";
import { runWorkflowWithOrgContext } from "../run-with-org.js";
import type { RoutedEnvelope } from "./ingress-router.worker.js";

/**
 * Module workers — consume module.* queues stamped by the ingress router.
 */
export async function startModuleWorkers(args: {
  boss: PgBoss;
  pool: Pool;
  compiler: GraphCompiler;
  runner: WorkflowRunner;
}): Promise<void> {
  const { boss, pool, compiler, runner } = args;

  for (const queue of MODULE_QUEUES) {
    await boss.createQueue(queue);
    await boss.work(queue, async (jobs: any[]) => {
      for (const job of jobs) {
        const envelope = job.data as RoutedEnvelope;
        console.log(
          `[Module] ${queue} ${envelope.event_type} (${envelope.event_id})`,
        );

        const workflowName = envelope.__graphKey;
        if (!workflowName) {
          throw new Error(`[Module] missing __graphKey on ${queue} job`);
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
          throw new Error(result.error);
        }

        console.log(
          `[Module] ${queue} → ${result.graphKey}@${result.graphVersion} completed`,
        );
      }
    });
    console.log(`Module worker listening on ${queue}`);
  }
}
