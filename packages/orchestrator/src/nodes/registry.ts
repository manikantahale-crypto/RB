import type { NodeFactory } from './types.js';
import { syntraJdProcess, syntraResumeProcess, syntraMatchProcess } from './syntra.js';
import { humanGate } from './human-gate.js';
import {
  astraRequirementNormalize,
  astraRouteDecision,
} from './astra.js';

/**
 * Production graph node registry — keys must match authoring TOOL_CATALOG.
 * Syntra HTTP adapters + ASTRA normalize/route + human approval gate.
 */
export const nodeRegistry = {
  'syntra.jd.process': (() => syntraJdProcess) as NodeFactory,
  'syntra.resume.process': (() => syntraResumeProcess) as NodeFactory,
  'syntra.match.process': (() => syntraMatchProcess) as NodeFactory,
  'astra.requirement.normalize': (() => astraRequirementNormalize) as NodeFactory,
  'astra.route.decision': (() => astraRouteDecision) as NodeFactory,
  'human.gate': (() => humanGate) as NodeFactory,
} as const satisfies Record<string, NodeFactory>;

export type NodeKey = keyof typeof nodeRegistry;
