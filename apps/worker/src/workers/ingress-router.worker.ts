import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import type { EventEnvelope } from '@tekisho/domain';
import type { GraphCompiler } from '@tekisho/orchestrator/src/graphs/compiler.js';
import {
  INGRESS_QUEUE,
  MODULE_SEND_OPTIONS,
  planForEvent,
} from '@tekisho/orchestrator/src/routing/table.js';
import { resolveActiveEventBinding } from '@tekisho/authoring/src/event-bindings.js';

export type RoutedEnvelope = EventEnvelope & {
  __graphKey: string;
  __graphVersion: number;
};

/**
 * Router — reads orchestration.ingress, resolves graph from DB bindings only.
 * No hardcoded PLATFORM_EVENT_PLAN graph fallback (Admin Authoring Layer v2).
 */
export async function startIngressRouter(args: {
  boss: PgBoss;
  compiler: GraphCompiler;
  pool: Pool;
}): Promise<void> {
  const { boss, compiler, pool } = args;

  await boss.createQueue(INGRESS_QUEUE);

  await boss.work(INGRESS_QUEUE, async (jobs: any[]) => {
    for (const job of jobs) {
      const envelope = job.data as EventEnvelope;
      console.log(
        `[Router] INGRESS ${envelope.event_type} event=${envelope.event_id} ` +
          `producer=${envelope.producer} aggregate=${envelope.aggregate.type}:${envelope.aggregate.id} ` +
          `correlation=${envelope.correlation_id}`,
      );

      const plan = planForEvent(envelope.event_type);
      if (plan.kind !== 'graph') {
        console.log(
          `[Router] ${plan.kind} ${envelope.event_type} — ${plan.note} (ack)`,
        );
        continue;
      }

      try {
        const binding = await resolveActiveEventBinding(
          pool,
          envelope.event_type,
          envelope.organization_id,
        );

        if (!binding) {
          console.warn(
            `[Router] no active DB binding for ${envelope.event_type} ` +
              `(org=${envelope.organization_id ?? '~global~'}) — unroutable; ack. ` +
              `Activate an agent for this event in Admin, or re-seed graph_event_bindings.`,
          );
          continue;
        }

        const graphKey = binding.graph_key;
        const moduleQueue = binding.module_queue;

        const graphVersion = await compiler.resolveActiveVersion(
          graphKey,
          envelope.organization_id,
        );

        const routed: RoutedEnvelope = {
          ...envelope,
          __graphKey: graphKey,
          __graphVersion: graphVersion,
        };

        await boss.send(moduleQueue, routed, {
          ...MODULE_SEND_OPTIONS,
          singletonKey: envelope.event_id,
        });
        console.log(
          `[Router] ROUTE ${envelope.event_type} → queue=${moduleQueue} ` +
            `graph=${graphKey}@${graphVersion} agent=${binding.agent_id ?? "n/a"} ` +
            `binding=${binding.source} event=${envelope.event_id}`,
        );
      } catch (err) {
        console.error(
          `[Router] FAILED ${envelope.event_type} (${envelope.event_id}):`,
          err,
        );
        throw err;
      }
    }
  });

  console.log(`Ingress router listening on ${INGRESS_QUEUE} (DB bindings only)`);
}
