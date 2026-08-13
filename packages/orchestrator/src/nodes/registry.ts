import type { NodeFactory } from './types.js';
import { syntraJdProcess, syntraResumeProcess, syntraMatchProcess } from './syntra.js';
import { testResumeNodeA, testResumeNodeB } from './test-resume.js';
import {
  cvSummarize,
  cvEmbed,
  jdMatch,
  matchPersist,
  humanGate,
  eventEmit,
  recordFailure,
} from './design.js';

/**
 * Live node registry.
 */
export const nodeRegistry = {
  'syntra.jd.process': (() => syntraJdProcess) as NodeFactory,
  'syntra.resume.process': (() => syntraResumeProcess) as NodeFactory,
  'syntra.match.process': (() => syntraMatchProcess) as NodeFactory,

  'cv.summarize': (() => cvSummarize) as NodeFactory,
  'cv.embed': (() => cvEmbed) as NodeFactory,
  'jd.match': (() => jdMatch) as NodeFactory,
  'match.persist': (() => matchPersist) as NodeFactory,

  'human.gate': (() => humanGate) as NodeFactory,
  'event.emit': (() => eventEmit) as NodeFactory,
  'system.record_failure': (() => recordFailure) as NodeFactory,

  'test.resume.a': (() => testResumeNodeA) as NodeFactory,
  'test.resume.b': (() => testResumeNodeB) as NodeFactory,
} as const satisfies Record<string, NodeFactory>;

export type NodeKey = keyof typeof nodeRegistry;
