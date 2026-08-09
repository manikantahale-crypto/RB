import type { EventInput, WorkflowResult } from '../types.js';
import type { Pool } from 'pg';
import type { GraphCompiler } from '../graphs/compiler.js';

/**
 * Executes a workflow by graph_key: compiler loads topology from DB,
 * hydrates nodes from the registry, invokes LangGraph, persists emitted events.
 */
export class WorkflowRunner {
  constructor(
    private compiler: GraphCompiler,
    private pool?: Pool
  ) {}

  public async executeWorkflow(
    workflow_name: string,
    event: EventInput,
    threadKey?: string,
    pinnedVersion?: number
  ): Promise<WorkflowResult> {
    try {
      const graph = await this.compiler.get(
        workflow_name,
        event.organization_id,
        pinnedVersion
      );

      // Prefer stable pg-boss job id (survives redelivery). Syntra path mints a new
      // event_id on every delivery, so event_id alone is not a resume key.
      const threadId = `${event.organization_id}:${threadKey ?? event.event_id}`;
      const config = {
        configurable: { thread_id: threadId },
        durability: 'sync' as const,
      };
      // Re-invoking with new input restarts from __start__. If a checkpoint already
      // has pending next nodes (crash mid-graph), resume with null input (D4).
      const snapshot = await graph.getState(config);
      const finalState =
        snapshot.next && snapshot.next.length > 0
          ? await graph.invoke(null, config)
          : await graph.invoke({ trigger_event: event }, config);

      const events: EventInput[] = finalState._emittedEvents || [];
      const cleanState = { ...finalState };
      delete cleanState._emittedEvents;
      delete cleanState.trigger_event;

      if (events.length > 0) {
        if (this.pool) {
          const client = await this.pool.connect();
          try {
            await client.query('BEGIN');
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
                ]
              );
            }
            await client.query('COMMIT');
            console.log(
              `[WorkflowRunner] wrote ${events.length} event(s) to event_outbox for ${workflow_name}`
            );
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          } finally {
            client.release();
          }
        } else {
          console.warn('WorkflowRunner: no pool provided, skipping event_outbox persistence');
        }
      }

      return {
        status: 'COMPLETED',
        events,
        finalState: cleanState,
      };
    } catch (error: any) {
      return {
        status: 'FAILED',
        events: [],
        finalState: {},
        error: error.message,
      };
    }
  }
}
