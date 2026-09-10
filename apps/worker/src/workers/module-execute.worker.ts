import type { Pool } from 'pg';

import type { PgBoss } from 'pg-boss';

import type { GraphCompiler } from '@tekisho/orchestrator/src/graphs/compiler.js';

import type { WorkflowRunner } from '@tekisho/orchestrator/src/workflow/runner.js';

import type { EventInput } from '@tekisho/orchestrator/src/types.js';

import {

  MODULE_QUEUES,

  MODULE_SEND_OPTIONS,

} from '@tekisho/orchestrator/src/routing/table.js';

import { classifyError } from '@tekisho/orchestrator/src/workflow/errors.js';

import { recordFailedWorkflow } from '@tekisho/orchestrator/src/workflow/failed-workflows.js';

import { runWorkflowWithOrgContext } from '../run-with-org.js';

import type { RoutedEnvelope } from './ingress-router.worker.js';

import {

  formatEventLine,

  orchStory,

  orchStoryDetail,

} from '@tekisho/orchestrator/src/observability/story-log.js';



/**

 * Module workers — consume module.* queues stamped by the ingress router.

 * Design §10: retryLimit 5 + backoff; permanent-input acks; permanent-system

 * records failed_workflows without spinning retries forever.

 */

export async function startModuleWorkers(args: {

  boss: PgBoss;

  pool: Pool;

  compiler: GraphCompiler;

  runner: WorkflowRunner;

}): Promise<void> {

  const { boss, pool, compiler, runner } = args;



  /**
   * QUEUES ARE DATA, NOT A CONSTANT.
   *
   * This used to loop over `MODULE_QUEUES` alone — five names in a TypeScript
   * file. A binding naming anything else was a door opening onto nothing: the
   * event was accepted by ingress, routed, stamped and enqueued, and then
   * nobody came. No error, because nothing failed.
   *
   * `module.relay` and `module.interview` were in exactly that state, carrying
   * five live bindings between them. Serving them required an engine release,
   * which is one of the three reasons onboarding a module used to cost a
   * deploy.
   *
   * So the list is now the union of what the code knows and what the database
   * says. `MODULE_QUEUES` stays as a FLOOR — a queue that is expected but has
   * no binding yet is still subscribed, so the first event to arrive is not
   * dropped waiting for a binding to exist.
   *
   * Read once at boot. A queue registered later needs a worker restart, which
   * is the same cost as any other subscription and far below an engine release.
   */
  const bound = await pool
    .query<{ module_queue: string }>(
      `SELECT DISTINCT queue_key AS module_queue
         FROM authoring.event_bindings
        WHERE status = 'active'`,
    )
    .then((r) => r.rows.map((x) => x.module_queue))
    .catch(() => [] as string[]);

  const queues = [...new Set<string>([...MODULE_QUEUES, ...bound])];

  const extra = queues.filter(
    (q) => !(MODULE_QUEUES as readonly string[]).includes(q),
  );
  orchStory(
    'RUN',
    `serving ${queues.length} module queues` +
      (extra.length ? ` (${extra.length} from bindings: ${extra.join(', ')})` : ''),
  );

  for (const queue of queues) {

    await boss.createQueue(queue);

    await boss.work(queue, async (jobs: any[]) => {

      for (const job of jobs) {

        const envelope = job.data as RoutedEnvelope;

        orchStory(

          'RUN',

          `queue=${queue}  graph=${envelope.__graphKey}@${envelope.__graphVersion ?? '?'}  ` +

            formatEventLine({

              eventType: envelope.event_type,

              eventId: envelope.event_id,

              orgId: envelope.organization_id,

              correlationId: envelope.correlation_id,

            }),

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



        const threadId = `${envelope.organization_id}:${job.id}`;



        try {

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



          if (result.status === 'COMPLETED' || result.status === 'PARKED') {

            const emitted = Array.isArray(result.events)

              ? result.events.map((e) => e.event_type)

              : [];

            orchStory(

              'DONE',

              `${result.status}  graph=${result.graphKey}@${result.graphVersion}` +

                `  trigger=${envelope.event_type}` +

                (result.threadId ? `  thread=${result.threadId}` : ''),

            );

            if (emitted.length) {

              orchStoryDetail(`next events: [${emitted.join(', ')}]`);

            }

            continue;

          }



          const errorClass =

            result.errorClass ?? classifyError(new Error(result.error ?? ''));



          // Permanent-input: product terminal — ack job (do not retry)

          if (errorClass === 'permanent-input') {

            console.warn(

              `[Module] permanent-input on ${envelope.event_id}: ${result.error}`,

            );

            continue;

          }



          // Permanent-system: record + ack — do not retry (same bug class won't heal)

          if (errorClass === 'permanent-system') {

            await recordFailedWorkflow(pool, {

              organization_id: envelope.organization_id,

              event_id: envelope.event_id,

              thread_id: threadId,

              graph_key: envelope.__graphKey,

              graph_version: envelope.__graphVersion ?? null,

              queue,

              error_class: errorClass,

              error_message: result.error ?? 'permanent-system',

              pinned_payload: envelope as unknown as Record<string, unknown>,

            });

            console.error(

              `[Orch] ── DONE   FAILED (acked)  graph=${envelope.__graphKey}  event=${envelope.event_id}: ${result.error}`,

            );

            continue;

          }



          // Transient: throw → pg-boss retry; on final attempt mirror DLQ

          const attempt = Number(job.retrycount ?? job.retryCount ?? 0);

          const limit = MODULE_SEND_OPTIONS.retryLimit;

          if (attempt >= limit) {

            await recordFailedWorkflow(pool, {

              organization_id: envelope.organization_id,

              event_id: envelope.event_id,

              thread_id: threadId,

              graph_key: envelope.__graphKey,

              graph_version: envelope.__graphVersion ?? null,

              queue,

              error_class: errorClass,

              error_message: result.error ?? 'exhausted retries',

              pinned_payload: envelope as unknown as Record<string, unknown>,

            });

          }

          throw new Error(result.error);

        } catch (err) {

          const msg = err instanceof Error ? err.message : String(err);

          const errorClass = classifyError(err);

          if (errorClass === 'permanent-input') {

            console.warn(`[Module] permanent-input caught: ${msg}`);

            continue;

          }

          throw err;

        }

      }

    });

    console.log(`Module worker listening on ${queue}`);

  }

}


