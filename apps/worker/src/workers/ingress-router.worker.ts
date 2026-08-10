import type { PgBoss } from "pg-boss";
import type { EventEnvelope } from "@tekisho/domain";
import { SimpleRunbookResolver } from "@tekisho/orchestrator/src/resolver/runbook.js";
import type { GraphCompiler } from "@tekisho/orchestrator/src/graphs/compiler.js";
import {
  EVENT_TO_GRAPH,
  EVENT_TO_MODULE_QUEUE,
  INGRESS_QUEUE,
} from "@tekisho/orchestrator/src/routing/table.js";

export type RoutedEnvelope = EventEnvelope & {
  __graphKey: string;
  __graphVersion: number;
};

/**
 * Router — reads orchestration.ingress, picks module queue, stamps graph version (D3).
 */
export async function startIngressRouter(args: {
  boss: PgBoss;
  compiler: GraphCompiler;
}): Promise<void> {
  const { boss, compiler } = args;
  const resolver = new SimpleRunbookResolver(EVENT_TO_GRAPH);

  await boss.createQueue(INGRESS_QUEUE);

  await boss.work(INGRESS_QUEUE, async (jobs: any[]) => {
    for (const job of jobs) {
      const envelope = job.data as EventEnvelope;
      console.log(
        `[Router] ingress ${envelope.event_type} (${envelope.event_id})`,
      );

      const graphKey = resolver.tryResolve(envelope.event_type);
      if (!graphKey) {
        console.log(
          `[Router] terminal / no runbook for ${envelope.event_type} — acking`,
        );
        continue;
      }

      const moduleQueue = EVENT_TO_MODULE_QUEUE[envelope.event_type];
      if (!moduleQueue) {
        throw new Error(
          `[Router] graph ${graphKey} has no module queue for ${envelope.event_type}`,
        );
      }

      const graphVersion = await compiler.resolveActiveVersion(
        graphKey,
        envelope.organization_id,
      );

      const routed: RoutedEnvelope = {
        ...envelope,
        __graphKey: graphKey,
        __graphVersion: graphVersion,
      };

      await boss.send(moduleQueue, routed);
      console.log(
        `[Router] → ${moduleQueue} ${graphKey}@${graphVersion}`,
      );
    }
  });

  console.log(`Ingress router listening on ${INGRESS_QUEUE}`);
}
