import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import type { EventEnvelope } from '@tekisho/domain';
import type { GraphCompiler } from '@tekisho/orchestrator/src/graphs/compiler.js';
import {
  INGRESS_QUEUE,
  MODULE_SEND_OPTIONS,
  planForEvent,
} from '@tekisho/orchestrator/src/routing/table.js';
import { decideRoute } from '@tekisho/orchestrator/src/routing/decide-route.js';
import { resolveActiveEventBinding } from '@tekisho/authoring/src/event-bindings.js';
import { resolveRoutes, RoutingError } from '@tekisho/routing-contract';
import { routingTable } from '../routing-table-cache.js';
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
      const orbitTag = envelope.event_type.startsWith('orbit.') ? '[ORBIT] ' : '';
      orchStory(
        'EVENT',
        `${orbitTag}${formatEventLine({
          eventType: envelope.event_type,
          eventId: envelope.event_id,
          orgId: envelope.organization_id,
          correlationId: envelope.correlation_id,
          aggregateId: envelope.aggregate?.id,
        })}  producer=${envelope.producer}  aggregate=${envelope.aggregate.type}:${envelope.aggregate.id}`,
      );

      try {
        /**
         * The binding decides; the hardcoded plan only fills the silence.
         * The precedence itself lives in `decideRoute`, where it is unit
         * tested — see that file for why it used to be the other way round and
         * what it cost.
         */
        /**
         * WHICH WORKFLOWS ANSWER THIS EVENT — possibly more than one.
         *
         * The table comes from `authoring.event_bindings`; `resolveRoutes` is
         * pure, with no database, clock or network, so the same event and
         * table always produce the same routes.
         *
         * `null` means the table has never loaded — NOT "nothing is bound".
         * Treating those as the same would stop every workflow in the system,
         * so an unloaded table falls back to the single-binding path below.
         */
        const table = routingTable();
        let targets: Array<{ graphKey: string; moduleQueue: string; via: string }> = [];

        if (table) {
          try {
            // Entitlements are empty until platform.features is populated, so
            // a binding with `requires_feature` set is skipped. That is the
            // entitlement seam working rather than a fault — and the first
            // thing to check if a binding stops firing.
            const routes = resolveRoutes(
              {
                event_type: envelope.event_type,
                organization_id: envelope.organization_id ?? null,
              },
              [],
              table,
            );
            targets = routes.flatMap((r) =>
              r.targetKind === 'graph' && r.workflowKey && r.moduleQueue
                ? [{ graphKey: r.workflowKey, moduleQueue: r.moduleQueue, via: r.ownerModule }]
                : [],
            );
          } catch (err) {
            // Two active bindings in one group sharing a priority. Refusing is
            // the point: silently choosing one is the failure exclusivity
            // exists to prevent.
            if (err instanceof RoutingError) {
              console.error(
                `[Orch] ── ROUTE  AMBIGUOUS ${envelope.event_type}: ${err.message}`,
              );
              continue;
            }
            throw err;
          }
        } else {
          const binding = await resolveActiveEventBinding(
            pool,
            envelope.event_type,
            envelope.organization_id,
          );

          const decision = decideRoute({
            eventType: envelope.event_type,
            organizationId: envelope.organization_id ?? null,
            binding,
            plan: planForEvent(envelope.event_type),
          });

          if (decision.kind === 'ack') {
            orchStory('ROUTE', `${decision.label}  ${decision.note}`);
            continue;
          }

          targets = [{
            graphKey: decision.graphKey,
            moduleQueue: decision.moduleQueue,
            via: binding?.source ?? 'binding',
          }];
        }

        if (targets.length === 0) {
          // A valid answer: published for a screen or an audit trail.
          orchStory('ROUTE', `${envelope.event_type}  nothing bound — acked`);
          continue;
        }

        for (const target of targets) {
        const graphKey = target.graphKey;
        const moduleQueue = target.moduleQueue;

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
          // The workflow key is part of the key, not just the event id. Under
          // fan-out two routes can land on ONE queue, and a shared singleton
          // key would collapse them into a single job — fan-out that silently
          // does not fan out.
          singletonKey: `${envelope.event_id}:${graphKey}`,
        });

        orchStory(
          'ROUTE',
          `${envelope.event_type} → ${moduleQueue}  graph=${graphKey}@${graphVersion}` +
            `  via=${target.via}` +
            (targets.length > 1 ? `  [${targets.length} routes]` : '') +
            `  next=run graph`,
        );
        }
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

