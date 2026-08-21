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
import {
  formatEventLine,
  orchStory,
} from '@tekisho/orchestrator/src/observability/story-log.js';

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
      orchStory(
        'EVENT',
        `${formatEventLine({
          eventType: envelope.event_type,
          eventId: envelope.event_id,
          orgId: envelope.organization_id,
          correlationId: envelope.correlation_id,
          aggregateId: envelope.aggregate?.id,
        })}  producer=${envelope.producer}  aggregate=${envelope.aggregate.type}:${envelope.aggregate.id}`,
      );

      const plan = planForEvent(envelope.event_type);
      if (plan.kind !== 'graph') {
        orchStory(
          'ROUTE',
          `${plan.kind.toUpperCase()}  ${envelope.event_type} — ${plan.note} (ack, no graph)`,
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
          orchStory(
            'ROUTE',
            `UNROUTABLE  ${envelope.event_type}  org=${envelope.organization_id ?? '~global~'} — no active binding (ack)`,
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
        orchStory(
          'ROUTE',
          `${envelope.event_type} → ${moduleQueue}  graph=${graphKey}@${graphVersion}` +
            `  agent=${binding.agent_id ?? 'n/a'}  via=${binding.source}  next=run graph`,
        );
      } catch (err) {
        console.error(
          `[Orch] ── ROUTE  FAILED ${envelope.event_type} (${envelope.event_id}):`,
          err,
        );
        throw err;
      }
    }
  });

  console.log(`Ingress router listening on ${INGRESS_QUEUE} (DB bindings only)`);
}
