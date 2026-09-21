import type { NodeFactory } from './types.js';
import { humanGate } from './human-gate.js';
import { orchBranchDecision } from './branch.js';

/**
 * What the engine still runs by itself: two platform control nodes that no
 * contract can express yet (`human.gate` parks a run with `interrupt()`;
 * `orch.branch.decision` publishes an event its declaration does not name).
 * Everything else — 31 nodes across SYNTRA, ASTRA, ORBIT, RELAY and PRISM —
 * is a contract in `adapters/` and is composed over this map by
 * `apps/worker/src/node-registry.ts`.
 *
 * The engine functions that used to sit here (syntra.ts, syntra-followups.ts,
 * astra.ts, orbit.ts) were deleted on 2026-09-21, once their contracts had
 * run against the live backends (ref/Orchestrator_Refinements.md §13).
 * Their behaviour is in the contracts, request for request; their history
 * is in git.
 */
export const nodeRegistry = {
  'orch.branch.decision': (() => orchBranchDecision) as NodeFactory,
  'human.gate': (() => humanGate) as NodeFactory,
} as const satisfies Record<string, NodeFactory>;

export type NodeKey = keyof typeof nodeRegistry;

/**
 * The shape GraphCompiler accepts.
 *
 * Open-keyed on purpose. The engine's own `nodeRegistry` above is one valid
 * value, but the registry the worker actually runs is *composed* — engine nodes
 * plus whatever the module adapters contribute — so it cannot be constrained to
 * `NodeKey`. A node moved to a contract keeps its key and overrides the entry
 * above; nothing here needs deleting when that happens.
 */
export type NodeRegistry = Record<string, NodeFactory>;
