import type { Pool, PoolClient } from 'pg';
import type { EventInput } from '../types.js';
import { withOrgConnection } from '../db/with-org-connection.js';
import type { LLMClient } from '../llm/types.js';
import type { NodeCtx, NodeDb, NodeEvents, NodeLogger } from './types.js';

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
 */
export function createNodeCtx(args: {
  orgId: string;
  config?: Record<string, unknown>;
  nodeId?: string;
  pool?: Pool;
  llm?: LLMClient;
  logger?: NodeLogger;
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

  const events: NodeEvents = {
    emit(event) {
      buffer.push(event);
    },
  };

  const ctx: NodeCtx = {
    orgId,
    config: args.config ?? {},
    logger: args.logger ?? {
      info: (...a: unknown[]) => console.log(`[node:${nodeId}]`, ...a),
      error: (...a: unknown[]) => console.error(`[node:${nodeId}]`, ...a),
    },
    llm: args.llm, // optional; resume-intake nodes must not require it
    db,
    events,
  };

  return { ctx, drainEvents: () => buffer.splice(0, buffer.length) };
}
