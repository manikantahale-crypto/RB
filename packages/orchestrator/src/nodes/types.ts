import type { EventInput } from '../types.js';

/** Cross-cutting deps injected into every node (design §4.1). */
export type NodeCtx = {
  orgId: string;
  config: Record<string, unknown>;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
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
