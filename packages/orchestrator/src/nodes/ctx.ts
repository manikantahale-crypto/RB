import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { EventInput } from '../types.js';
import { withOrgConnection } from '../db/with-org-connection.js';
import type { LLMClient } from '../llm/types.js';
import type { NodeCtx, NodeDb, NodeEvents, NodeLogger } from './types.js';
import { deterministicEventId } from '../workflow/deterministic-id.js';

/**
 * Per-node dependency bag (design §4.1).
 *
 * Nodes must NOT import live singletons (DB pool, LLM SDK). The compiler builds
 * a fresh `NodeCtx` for every node invocation and injects:
 * - `orgId` / `db.withOrg` — RLS via SET LOCAL app.org_id
 * - `llm` — optional seam only; backbone / resume-intake must not require it
 * - `events.emit` — buffered; runner drains into event_outbox
 * - `config` — per-node JSON from graph_definitions
 * - `logger` — pre-bound with node id
 * - `signal` — aborted when the node's time is up; never aborted if absent
 * - `runKey` — the thread this node runs in (`org:trigger_event_id`); with
 *   it, an emit without an id gets one derived from run + step + type +
 *   position, so a re-run step emits the same event, not a second one
 */
export function createNodeCtx(args: {
  orgId: string;
  config?: Record<string, unknown>;
  nodeId?: string;
  graphKey?: string;
  /** `org:trigger_event_id` — what a retry shares with its first attempt. */
  runKey?: string;
  pool?: Pool;
  llm?: LLMClient;
  logger?: NodeLogger;
  signal?: AbortSignal;
}): { ctx: NodeCtx; drainEvents: () => EventInput[] } {
  const buffer: EventInput[] = [];
  const orgId = args.orgId;
  const nodeId = args.nodeId ?? 'node';

  const db: NodeDb = args.pool
    ? {
        withOrg: <T>(fn: (client: PoolClient) => Promise<T>) =>
          withOrgConnection(args.pool!, orgId, fn),
      }
    : {
        withOrg: async () => {
          throw new Error('NodeCtx.db: no pool configured');
        },
      };

  /**
   * The position of each event type within THIS node's emissions, so the
   * second `x.happened` a step emits gets a different id from the first —
   * and the same second id on a re-run.
   */
  const emitted = new Map<string, number>();
  const events: NodeEvents = {
    emit(event) {
      if (event.event_id) {
        buffer.push(event as EventInput);
        return;
      }
      const index = emitted.get(event.event_type) ?? 0;
      emitted.set(event.event_type, index + 1);
      // No run key — a node under test, or a caller that did not say — and
      // the id is random as it always was. Never derived from nothing.
      const runKey = args.runKey;
      const event_id = runKey
        ? deterministicEventId({ runKey, nodeId, eventType: event.event_type, index })
        : randomUUID();
      buffer.push({ ...event, event_id });
    },
  };

  const ctx: NodeCtx = {
    orgId,
    nodeId,
    graphKey: args.graphKey,
    config: args.config ?? {},
    logger: args.logger ?? {
      info: (...a: unknown[]) => console.log(`[node:${nodeId}]`, ...a),
      error: (...a: unknown[]) => console.error(`[node:${nodeId}]`, ...a),
    },
    llm: args.llm, // optional; resume-intake nodes must not require it
    db,
    events,
    signal: args.signal ?? new AbortController().signal,
  };

  return { ctx, drainEvents: () => buffer.splice(0, buffer.length) };
}
