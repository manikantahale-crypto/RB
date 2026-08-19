import type { NodeFactory } from './types.js';
import { syntraJdProcess, syntraResumeProcess, syntraMatchProcess } from './syntra.js';
import {
  syntraBenchAlert,
  syntraContinuousMatch,
  syntraDuplicateDetect,
  syntraDuplicateMerge,
  syntraRunRetry,
  syntraShortlistNotify,
} from './syntra-followups.js';
import { humanGate } from './human-gate.js';
import {
  astraRequirementNormalize,
  astraRouteDecision,
  astraRequirementIntake,
  astraRequirementIngest,
  astraJobboardFetch,
  astraRequirementQuality,
} from './astra.js';
import { orchBranchDecision } from './branch.js';

/**
 * Production graph node registry — keys must match authoring TOOL_CATALOG.
 * Includes ASTRA Option-B tools + Syntra follow-ups from syntra_orch_tools.
 */
export const nodeRegistry = {
  'syntra.jd.process': (() => syntraJdProcess) as NodeFactory,
  'syntra.resume.process': (() => syntraResumeProcess) as NodeFactory,
  'syntra.match.process': (() => syntraMatchProcess) as NodeFactory,
  'syntra.continuous.match': (() => syntraContinuousMatch) as NodeFactory,
  'syntra.duplicate.detect': (() => syntraDuplicateDetect) as NodeFactory,
  'syntra.bench.alert': (() => syntraBenchAlert) as NodeFactory,
  'syntra.shortlist.notify': (() => syntraShortlistNotify) as NodeFactory,
  'syntra.duplicate.merge': (() => syntraDuplicateMerge) as NodeFactory,
  'syntra.run.retry': (() => syntraRunRetry) as NodeFactory,
  'astra.requirement.intake': (() => astraRequirementIntake) as NodeFactory,
  'astra.requirement.ingest': (() => astraRequirementIngest) as NodeFactory,
  'astra.jobboard.fetch': (() => astraJobboardFetch) as NodeFactory,
  'astra.requirement.quality': (() => astraRequirementQuality) as NodeFactory,
  'astra.requirement.normalize': (() => astraRequirementNormalize) as NodeFactory,
  'astra.route.decision': (() => astraRouteDecision) as NodeFactory,
  'orch.branch.decision': (() => orchBranchDecision) as NodeFactory,
  'human.gate': (() => humanGate) as NodeFactory,
} as const satisfies Record<string, NodeFactory>;

export type NodeKey = keyof typeof nodeRegistry;
