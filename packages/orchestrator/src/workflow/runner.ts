import type { EventInput, WorkflowResult } from '../types.js';
import type { Pool } from 'pg';
import { Command, isGraphInterrupt } from '@langchain/langgraph';
import type { GraphCompiler } from '../graphs/compiler.js';
import { withOrgConnection } from '../db/with-org-connection.js';
import { validateEntryInput } from '../contracts/payloads.js';
import { classifyError, ClassifiedError } from './errors.js';
import { recordWorkflowMetric } from '../observability/metrics.js';
import { finishAgentRun, startAgentRun } from './agent-runs.js';

/**
 * Executes a workflow by graph_key: compiler loads topology from DB,
 * hydrates nodes from the registry, invokes LangGraph, persists emitted events.
 */
export class WorkflowRunner {
  constructor(
    private compiler: GraphCompiler,
    private pool?: Pool,
  ) {}

  public async executeWorkflow(
    workflow_name: string,
    event: EventInput,
    threadKey?: string,
    pinnedVersion?: number,
  ): Promise<WorkflowResult> {
    const started = Date.now();
    const threadId = `${event.organization_id}:${threadKey ?? event.event_id}`;
    let agentRunId: string | null = null;

    try {
      const def = await this.compiler.loadDefinition(
        workflow_name,
        event.organization_id,
        pinnedVersion,
      );
      const payload = validateEntryInput(def.entryInput, event.payload);
      const trigger: EventInput = { ...event, payload };

      if (this.pool) {
        agentRunId = await startAgentRun({
          pool: this.pool,
          organizationId: event.organization_id,
          agentName: def.agentName ?? 'intake-agent',
          triggerEventId: event.event_id,
          graphKey: workflow_name,
          langgraphThreadId: threadId,
          inputRef: {
            event_type: event.event_type,
            correlation_id: event.correlation_id,
          },
        });
      }

      const graph = await this.compiler.get(
        workflow_name,
        event.organization_id,
        pinnedVersion,
      );

      const config = {
        configurable: { thread_id: threadId },
        durability: 'sync' as const,
      };
      const snapshot = await graph.getState(config);
      console.log(
        `[WorkflowRunner] invoke ${workflow_name} event=${event.event_id}` +
          ` corr=${event.correlation_id} thread=${threadId}` +
          (agentRunId ? ` agent_run=${agentRunId}` : ''),
      );
      const finalState =
        snapshot.next && snapshot.next.length > 0
          ? await graph.invoke(null, config)
          : await graph.invoke(
              { trigger_event: trigger, agent_run_id: agentRunId },
              config,
            );

      return await this.finishOk(
        workflow_name,
        event,
        finalState,
        threadId,
        started,
        agentRunId,
      );
    } catch (error: unknown) {
      if (isGraphInterrupt(error)) {
        const emitted =
          (error as { __orchEmitted?: EventInput[] }).__orchEmitted ?? [];
        if (emitted.length && this.pool) {
          await this.persistEvents(event, emitted);
        }
        if (this.pool && agentRunId) {
          await finishAgentRun({
            pool: this.pool,
            organizationId: event.organization_id,
            runId: agentRunId,
            status: 'WAITING_APPROVAL',
          });
        }
        recordWorkflowMetric({
          graphKey: workflow_name,
          status: 'interrupted',
          durationMs: Date.now() - started,
          threadId,
        });
        console.log(
          `[WorkflowRunner] PARKED ${workflow_name} thread=${threadId} (human.gate)`,
        );
        return {
          status: 'PARKED',
          events: emitted,
          finalState: { thread_id: threadId, interrupt: true },
          threadId,
        };
      }
      const classified =
        error instanceof ClassifiedError
          ? error
          : new ClassifiedError(
              error instanceof Error ? error.message : String(error),
              classifyError(error),
              { graphKey: workflow_name, cause: error },
            );
      if (this.pool && agentRunId) {
        await finishAgentRun({
          pool: this.pool,
          organizationId: event.organization_id,
          runId: agentRunId,
          status: 'FAILED',
          error: {
            message: classified.message,
            errorClass: classified.errorClass,
          },
        });
      }
      recordWorkflowMetric({
        graphKey: workflow_name,
        status: 'failed',
        durationMs: Date.now() - started,
        threadId,
        errorClass: classified.errorClass,
      });
      console.error(
        `[WorkflowRunner] FAILED ${workflow_name} event=${event.event_id}: ${classified.message}`,
      );
      return {
        status: 'FAILED',
        events: [],
        finalState: {},
        error: classified.message,
        errorClass: classified.errorClass,
      };
    }
  }

  /**
   * Design §9.2 — resume a parked thread after human.gate interrupt.
   * Job completes successfully when interrupted; this continues from checkpoint.
   */
  public async resumeThread(args: {
    graphKey: string;
    organizationId: string;
    threadId: string;
    decision: unknown;
    graphVersion?: number;
  }): Promise<WorkflowResult> {
    const { graphKey, organizationId, threadId, decision, graphVersion } = args;
    const started = Date.now();
    try {
      const graph = await this.compiler.get(
        graphKey,
        organizationId,
        graphVersion,
      );
      const config = {
        configurable: { thread_id: threadId },
        durability: 'sync' as const,
      };
      const finalState = await graph.invoke(
        new Command({ resume: decision }),
        config,
      );
      const synthetic: EventInput = {
        event_id: threadId.split(':')[1] ?? threadId,
        event_type: 'system.thread.resume',
        aggregate_id: threadId,
        aggregate_type: 'thread',
        organization_id: organizationId,
        correlation_id: threadId,
        payload: { decision },
      };
      return await this.finishOk(
        graphKey,
        synthetic,
        finalState,
        threadId,
        started,
        typeof finalState?.agent_run_id === 'string'
          ? finalState.agent_run_id
          : null,
      );
    } catch (error: unknown) {
      if (isGraphInterrupt(error)) {
        recordWorkflowMetric({
          graphKey,
          status: 'interrupted',
          durationMs: Date.now() - started,
          threadId,
        });
        return {
          status: 'PARKED',
          events: [],
          finalState: { thread_id: threadId, interrupt: true },
          threadId,
        };
      }
      const msg = error instanceof Error ? error.message : String(error);
      recordWorkflowMetric({
        graphKey,
        status: 'failed',
        durationMs: Date.now() - started,
        threadId,
        errorClass: classifyError(error),
      });
      return {
        status: 'FAILED',
        events: [],
        finalState: {},
        error: msg,
        errorClass: classifyError(error),
      };
    }
  }

  private async persistEvents(
    event: EventInput,
    events: EventInput[],
  ): Promise<void> {
    if (!this.pool || events.length === 0) return;
    await withOrgConnection(this.pool, event.organization_id, async (client) => {
      for (const generatedEvent of events) {
        await client.query(
          `INSERT INTO event_outbox (
            event_id, event_type, schema_version, organization_id,
            aggregate_type, aggregate_id, correlation_id, causation_id,
            producer, payload_ref
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            generatedEvent.event_id,
            generatedEvent.event_type,
            '1.0',
            generatedEvent.organization_id,
            generatedEvent.aggregate_type,
            generatedEvent.aggregate_id,
            generatedEvent.correlation_id,
            event.event_id,
            'orchestrator',
            generatedEvent.payload,
          ],
        );
      }
    });
    console.log(
      `[WorkflowRunner] wrote ${events.length} follow-on event(s) to event_outbox` +
        ` (types: ${events.map((e) => e.event_type).join(', ')})`,
    );
  }

  private async finishOk(
    workflow_name: string,
    event: EventInput,
    finalState: Record<string, any>,
    threadId: string,
    started = Date.now(),
    agentRunId: string | null = null,
  ): Promise<WorkflowResult> {
    const runId =
      agentRunId ??
      (typeof finalState?.agent_run_id === 'string'
        ? finalState.agent_run_id
        : null);

    if (finalState?.__interrupt__ || finalState?.interrupt) {
      if (this.pool && runId) {
        await finishAgentRun({
          pool: this.pool,
          organizationId: event.organization_id,
          runId,
          status: 'WAITING_APPROVAL',
        });
      }
      recordWorkflowMetric({
        graphKey: workflow_name,
        status: 'interrupted',
        durationMs: Date.now() - started,
        threadId,
      });
      return {
        status: 'PARKED',
        events: [],
        finalState: { ...finalState, thread_id: threadId },
        threadId,
      };
    }

    const events: EventInput[] = finalState._emittedEvents || [];
    const cleanState = { ...finalState };
    delete cleanState._emittedEvents;
    delete cleanState.trigger_event;

    await this.persistEvents(event, events);

    if (this.pool && runId) {
      await finishAgentRun({
        pool: this.pool,
        organizationId: event.organization_id,
        runId,
        status: 'COMPLETED',
      });
    }

    recordWorkflowMetric({
      graphKey: workflow_name,
      status: 'completed',
      durationMs: Date.now() - started,
      threadId,
    });

    console.log(
      `[WorkflowRunner] COMPLETED ${workflow_name} event=${event.event_id}` +
        ` emitted=${events.length}` +
        (runId ? ` agent_run=${runId}` : ''),
    );

    return {
      status: 'COMPLETED',
      events,
      finalState: cleanState,
      threadId,
    };
  }
}
