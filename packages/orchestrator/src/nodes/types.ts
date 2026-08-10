import type { PoolClient } from 'pg';
import type { EventInput } from '../types.js';
import type { LLMClient } from '../llm/types.js';

export type NodeLogger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

/** Org-scoped DB access — always runs under `app.org_id` (design §4.1 / §11). */
export type NodeDb = {
  withOrg: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
};

/** Collect outbound domain events; runner persists to event_outbox. */
export type NodeEvents = {
  emit: (event: EventInput) => void;
};

/**
 * Cross-cutting deps injected into every node (design §4.1).
 * `llm` is Noop until a real client is wired; Syntra nodes use HTTP today.
 */
export type NodeCtx = {
  orgId: string;
  config: Record<string, unknown>;
  logger: NodeLogger;
  llm: LLMClient;
  db: NodeDb;
  events: NodeEvents;
};

/** Shared LangGraph state for Syntra (and similar) workflows. */
export type SyntraGraphState = {
  result: string;
  _emittedEvents: EventInput[];
  trigger_event: EventInput | null;
};

export type NodeImpl = (
  state: SyntraGraphState,
  ctx: NodeCtx
) => Promise<Partial<SyntraGraphState>>;

export type NodeFactory = () => NodeImpl;
