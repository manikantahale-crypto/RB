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

/**
 * Production graph node registry — keys must match authoring TOOL_CATALOG.
 * Syntra HTTP adapters + human approval gate only (no legacy cv.* / parse_* stubs).
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
  'human.gate': (() => humanGate) as NodeFactory,
} as const satisfies Record<string, NodeFactory>;

export type NodeKey = keyof typeof nodeRegistry;
