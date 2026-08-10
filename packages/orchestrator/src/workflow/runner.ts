import type { Pool } from 'pg';
import type { EventInput, WorkflowResult } from '../types.js';
import type { DBRunbookResolver, GraphDefinition } from '../resolver.js';
import { Registry } from './registry.js';
import { GraphCompiler } from './compiler.js';

export class WorkflowRunner {
  private resolver: DBRunbookResolver;
  private registry: Registry;
  private pool: Pool;

  constructor(resolver: DBRunbookResolver, registry: Registry, pool: Pool) {
    this.resolver = resolver;
    this.registry = registry;
    this.pool = pool;
  }

  public async executeWorkflow(event: EventInput): Promise<WorkflowResult> {
    try {
      // 1. Resolve workflow definition
      const orgId = event.payload?.org_id || null;
      const graphDef = await this.resolver.resolve(event.event_type, orgId);
      
      // 2. Check cache or compile
      const cacheKey = Registry.buildCacheKey(graphDef.org_id, graphDef.graph_key, graphDef.checksum);
      let graph = this.registry.getGraph(cacheKey);
      
      if (!graph) {
        graph = GraphCompiler.compile(graphDef);
        this.registry.registerGraph(cacheKey, graph);
      }

      // 3. Execute graph
      // Note: trigger_event is passed into state so the Syntra nodes can extract IDs.
      const finalState = await graph.invoke({
        trigger_event: event
      });

      const emittedEvents: EventInput[] = finalState._emittedEvents || [];
      const cleanState = { ...finalState };
      delete cleanState._emittedEvents;

      // 4. Persist emitted events to event_outbox (transactionally if there were multiple, but we just insert)
      if (emittedEvents.length > 0) {
        await this.persistOutboxEvents(emittedEvents, event);
      }

      return {
        status: 'COMPLETED',
        events: emittedEvents,
        finalState: cleanState
      };
    } catch (error: any) {
      return {
        status: 'FAILED',
        events: [],
        finalState: {},
        error: error.message
      };
    }
  }

  private async persistOutboxEvents(events: EventInput[], causeEvent: EventInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of events) {
        await client.query(`
          INSERT INTO event_outbox (
            event_id, event_type, schema_version, organization_id,
            aggregate_type, aggregate_id, correlation_id, causation_id,
            producer, payload_ref, occurred_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()
          )`,
          [
            e.event_id,
            e.event_type,
            '1.0',
            causeEvent.payload?.org_id || 'UNKNOWN',
            'orchestrator',
            e.aggregate_id,
            causeEvent.event_id, // correlation_id propagates original event_id
            causeEvent.event_id, // causation_id is the immediate trigger
            'orchestrator-engine',
            e.payload
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
