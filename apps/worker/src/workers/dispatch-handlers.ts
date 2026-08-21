import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import type { EventEnvelope } from '@tekisho/domain';
import {
  planForEvent,
  RESUME_THREAD_QUEUE,
  DISPATCH_QUEUE,
  MODULE_SEND_OPTIONS,
} from '@tekisho/orchestrator/src/routing/table.js';
import { recordFailedWorkflow } from '@tekisho/orchestrator/src/workflow/failed-workflows.js';
import { recordTerminalEvent } from '@tekisho/orchestrator/src/observability/metrics.js';
import type { ResumeThreadJob } from './resume-thread.worker.js';

/**
 * Handle non-graph platform events on orchestration.dispatch (design day-1).
 * Graph events are normally routed via ingress → module.*; dispatch still sees
 * follow-on / terminal events from the outbox relay.
 */
export async function handlePlatformDispatchEvent(args: {
  boss: PgBoss;
  pool: Pool;
  envelope: EventEnvelope;
}): Promise<'acked' | 'enqueued_resume' | 'recorded_fail'> {
  const { boss, pool, envelope } = args;
  const plan = planForEvent(envelope.event_type);
  const payload = (envelope.payload_ref ?? {}) as Record<string, unknown>;

  if (plan.kind === 'terminal') {
    recordTerminalEvent({
      eventType: envelope.event_type,
      organizationId: envelope.organization_id,
      correlationId: envelope.correlation_id,
    });
    console.log(
      `[Dispatcher] ${plan.kind} ${envelope.event_type}` +
        ` correlation=${envelope.correlation_id} event=${envelope.event_id}` +
        ` — ${plan.note}`,
    );
    return 'acked';
  }

  if (plan.kind === 'resume') {
    const threadId = String(
      payload.thread_id ?? payload.threadId ?? '',
    );
    const graphKey = String(
      payload.graph_key ?? payload.graphKey ?? '',
    );
    if (!threadId || !graphKey) {
      console.log(
        `[Dispatcher] approval.decided missing thread_id/graph_key — ack (${plan.note})`,
      );
      return 'acked';
    }
    const job: ResumeThreadJob = {
      thread_id: threadId,
      graph_key: graphKey,
      graph_version:
        typeof payload.graph_version === 'number'
          ? payload.graph_version
          : typeof payload.graphVersion === 'number'
            ? payload.graphVersion
            : undefined,
      organization_id: envelope.organization_id,
      decision: payload.decision ?? payload,
    };
    await boss.createQueue(RESUME_THREAD_QUEUE);
    await boss.send(RESUME_THREAD_QUEUE, job, {
      ...MODULE_SEND_OPTIONS,
      singletonKey: `${envelope.event_id}:resume`,
    });
    console.log(
      `[Dispatcher] approval.decided → ${RESUME_THREAD_QUEUE} thread=${threadId}`,
    );
    return 'enqueued_resume';
  }

  if (plan.kind === 'fail') {
    await recordFailedWorkflow(pool, {
      organization_id: envelope.organization_id,
      event_id: envelope.event_id,
      thread_id: `${envelope.organization_id}:${envelope.event_id}`,
      graph_key: String(payload.failed_node ?? 'agent_run'),
      graph_version: null,
      queue: DISPATCH_QUEUE,
      error_class: 'permanent-system',
      error_message: String(
        payload.error_message ?? payload.error_code ?? 'agent_run.failed',
      ),
      pinned_payload: envelope as unknown as Record<string, unknown>,
    });
    console.log(
      `[Dispatcher] agent_run.failed → failed_workflows (${envelope.event_id})`,
    );
    return 'recorded_fail';
  }

  // kind === 'graph' on dispatch is unusual (normally module.*); leave to caller
  console.log(
    `[Dispatcher] graph-capable event on dispatch: ${envelope.event_type} — caller should run workflow`,
  );
  return 'acked';
}
