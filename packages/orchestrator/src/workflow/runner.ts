import type { EventInput, WorkflowResult } from '../types.js';
import type { Pool } from 'pg';
import { Command, isGraphInterrupt } from '@langchain/langgraph';
import type { GraphCompiler } from '../graphs/compiler.js';
import { withOrgConnection } from '../db/with-org-connection.js';
import { validateEntryInput } from '../contracts/payloads.js';
import { classifyError, ClassifiedError } from './errors.js';
import { recordWorkflowMetric } from '../observability/metrics.js';
import { orchStory, orchStoryDetail } from '../observability/story-log.js';
import { claimRun, finishAgentRun } from './agent-runs.js';
import { claimParkedRun } from './parked-runs.js';
import { PARKED } from './run-status.js';

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
        const claim = await claimRun({
          pool: this.pool,
          organizationId: event.organization_id,
          agentName: def.agentName ?? 'intake-agent',
          triggerEventId: event.event_id,
          graphKey: workflow_name,
          // The pin the router decided, recorded on the run so run detail can
          // later draw the topology this run actually executed.
          //
          // Null when nothing pinned — a manual run, or a caller that did not
          // resolve a version. Left null rather than filled in with whatever
          // is active now: "we do not know which version this ran" is true and
          // checkable, while a guess would look identical to a fact.
          graphVersion: pinnedVersion ?? null,
          langgraphThreadId: threadId,
          inputRef: {
            event_type: event.event_type,
            correlation_id: event.correlation_id,
          },
        });
        /**
         * THIS DELIVERY IS A DUPLICATE. The run for this event and workflow
         * already finished, or is parked at a gate waiting for a person.
         * Running the graph again would redo pure steps — a gate would ask
         * for approval again — so it is declined here, and said so.
         */
        if (claim.kind === 'settled') {
          orchStory(
            'SKIP',
            `${workflow_name}  event=${event.event_id}  run ${claim.runId} is ${claim.status} — duplicate delivery declined`,
          );
          return {
            status: 'SKIPPED',
            events: [],
            finalState: { thread_id: threadId, status: claim.status },
            threadId,
            runId: claim.runId,
          };
        }
        agentRunId = claim.kind === 'unrecorded' ? null : claim.runId;
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
      orchStory(
        'GRAPH',
        `invoke ${workflow_name}  event=${event.event_id}  type=${event.event_type}` +
          `  corr=${event.correlation_id}  thread=${threadId}` +
          (agentRunId ? `  agent_run=${agentRunId}` : ''),
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
            status: PARKED,
          });
        }
        recordWorkflowMetric({
          graphKey: workflow_name,
          status: 'interrupted',
          durationMs: Date.now() - started,
          threadId,
        });
        orchStory(
          'DONE',
          `PARKED  graph=${workflow_name}  thread=${threadId}  next=human.gate resume`,
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
        `[Orch] ── DONE   FAILED  graph=${workflow_name}  event=${event.event_id}: ${classified.message}`,
      );
      return {
        status: 'FAILED',
        events: [],
        finalState: {},
        error: classified.message,
        errorClass: classified.errorClass,
        runId: agentRunId,
        failedNode: classified.nodeId ?? null,
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

    /**
     * TAKE THE RUN BACK BEFORE CONTINUING IT.
     *
     * PARKED → RUNNING, atomically, or nothing. A decision delivered twice
     * finds nothing the second time and is declined here rather than handed
     * to LangGraph as a second resume. A run that has no record (a manual
     * thread, a run from before the audit tables) is resumed as before —
     * the claim is a guard, not a gate.
     */
    let claimed: Awaited<ReturnType<typeof claimParkedRun>> = null;
    if (this.pool) {
      claimed = await claimParkedRun(this.pool, { threadId, graphKey });
      if (!claimed) {
        const { rows } = await this.pool.query<{ status: string }>(
          `SELECT status FROM orch.runs WHERE langgraph_thread_id = $1 AND graph_key = $2 LIMIT 1`,
          [threadId, graphKey],
        );
        if (rows[0]) {
          orchStory(
            'RESUME',
            `SKIPPED  graph=${graphKey}  thread=${threadId}  run is ${rows[0].status}, not PARKED — decision ignored`,
          );
          return {
            status: 'SKIPPED',
            events: [],
            finalState: { thread_id: threadId, status: rows[0].status },
            threadId,
          };
        }
      }
    }
    const runId = claimed?.id ?? null;
    const pinned = graphVersion ?? claimed?.graph_version ?? undefined;

    try {
      const graph = await this.compiler.get(
        graphKey,
        organizationId,
        pinned,
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
        runId ??
          (typeof finalState?.agent_run_id === 'string'
            ? finalState.agent_run_id
            : null),
      );
    } catch (error: unknown) {
      if (isGraphInterrupt(error)) {
        // Parked again — remind, wait, remind. The record says so this time;
        // before the claim it kept the status of its first park by luck.
        if (this.pool && runId) {
          await finishAgentRun({
            pool: this.pool,
            organizationId,
            runId,
            status: PARKED,
          });
        }
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
      if (this.pool && runId) {
        // A failed resume used to leave the run at its parked status for
        // ever; now it is a FAILED run with the reason on it.
        await finishAgentRun({
          pool: this.pool,
          organizationId,
          runId,
          status: 'FAILED',
          error: { message: msg, errorClass: classifyError(error) },
        });
      }
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
    /**
     * An event id is derived from run + step + type + position
     * (workflow/deterministic-id.ts), so a step that is run again emits the
     * SAME event. UNIQUE (event_id) on the outbox refuses the copy; DO
     * NOTHING turns that refusal from a failed run into a line in the log.
     * Before this, a duplicate was simply a second row.
     */
    const alreadyThere: string[] = [];
    await withOrgConnection(this.pool, event.organization_id, async (client) => {
      for (const generatedEvent of events) {
        const { rowCount } = await client.query(
          `INSERT INTO orch.event_outbox (
            event_id, event_type, schema_version, organization_id,
            aggregate_type, aggregate_id, correlation_id, causation_id,
            producer, payload_ref
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (event_id) DO NOTHING`,
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
        if (rowCount === 0) alreadyThere.push(generatedEvent.event_id);
      }
    });
    orchStory(
      'EMIT',
      `trigger=${event.event_type}  causation=${event.event_id}  corr=${event.correlation_id}`,
    );
    for (const generatedEvent of events) {
      orchStoryDetail(
        `→ outbox ${generatedEvent.event_type}  id=${generatedEvent.event_id}  ` +
          `aggregate=${generatedEvent.aggregate_type}:${generatedEvent.aggregate_id}  (relay → graph_event_bindings)`,
      );
    }
    orchStoryDetail(
      `wrote ${events.length - alreadyThere.length} follow-on event(s) → event_outbox: [${events.map((e) => e.event_type).join(', ')}]`,
    );
    if (alreadyThere.length > 0) {
      orchStoryDetail(
        `${alreadyThere.length} already in the outbox from an earlier attempt — not duplicated: ${alreadyThere.join(', ')}`,
      );
    }
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
          status: PARKED,
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
        runId,
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

    orchStory(
      'DONE',
      `COMPLETED  graph=${workflow_name}  event=${event.event_id}` +
        `  emitted=${events.length}` +
        (runId ? `  agent_run=${runId}` : ''),
    );
    if (events.length) {
      orchStoryDetail(
        `next events: [${events.map((e) => e.event_type).join(', ')}]`,
      );
    }

    return {
      status: 'COMPLETED',
      events,
      finalState: cleanState,
      threadId,
    };
  }
}
