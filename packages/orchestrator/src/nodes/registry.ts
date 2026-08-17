import type { NodeFactory } from './types.js';
import { syntraJdProcess, syntraResumeProcess, syntraMatchProcess } from './syntra.js';
import { humanGate } from './human-gate.js';

/**
 * Production graph node registry — keys must match authoring TOOL_CATALOG.
 * Syntra HTTP adapters + human approval gate only (no legacy cv.* / parse_* stubs).
 */
export const nodeRegistry = {
  'syntra.jd.process': (() => syntraJdProcess) as NodeFactory,
  'syntra.resume.process': (() => syntraResumeProcess) as NodeFactory,
  'syntra.match.process': (() => syntraMatchProcess) as NodeFactory,
  'human.gate': (() => humanGate) as NodeFactory,
} as const satisfies Record<string, NodeFactory>;

export type NodeKey = keyof typeof nodeRegistry;
