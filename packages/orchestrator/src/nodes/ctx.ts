import type { Pool, PoolClient } from 'pg';
import type { EventInput } from '../types.js';
import { withOrgConnection } from '../db/with-org-connection.js';
import type { LLMClient } from '../llm/types.js';
import { noopLlm } from '../llm/noop.js';
import type { NodeCtx, NodeDb, NodeEvents, NodeLogger } from './types.js';

const defaultLogger = (nodeId: string): NodeLogger => ({
  info: (...args: unknown[]) => console.log(`[node:${nodeId}]`, ...args),
  error: (...args: unknown[]) => console.error(`[node:${nodeId}]`, ...args),
});

function createNodeDb(pool: Pool | undefined, orgId: string): NodeDb {
  if (!pool) {
    return {
      withOrg: async () => {
        throw new Error('NodeCtx.db: no pool configured');
      },
    };
  }
  return {
    withOrg: <T>(fn: (client: PoolClient) => Promise<T>) =>
      withOrgConnection(pool, orgId, fn),
  };
}

function createNodeEvents(buffer: EventInput[]): NodeEvents {
  return {
    emit(event) {
      buffer.push(event);
    },
  };
}

export type CreateNodeCtxArgs = {
  orgId: string;
  config?: Record<string, unknown>;
  /** Used for log prefixes; defaults to "node". */
  nodeId?: string;
  pool?: Pool;
  llm?: LLMClient;
  logger?: NodeLogger;
};

/**
 * Build a per-node invocation context (design §4.1).
 * Call `drainEvents()` after the node returns and merge into `_emittedEvents`.
 */
export function createNodeCtx(args: CreateNodeCtxArgs): {
  ctx: NodeCtx;
  drainEvents: () => EventInput[];
} {
  const buffer: EventInput[] = [];
  const orgId = args.orgId;
  const ctx: NodeCtx = {
    orgId,
    config: args.config ?? {},
    logger: args.logger ?? defaultLogger(args.nodeId ?? 'node'),
    llm: args.llm ?? noopLlm,
    db: createNodeDb(args.pool, orgId),
    events: createNodeEvents(buffer),
  };
  return {
    ctx,
    drainEvents: () => buffer.splice(0, buffer.length),
  };
}
