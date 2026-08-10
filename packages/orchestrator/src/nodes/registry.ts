import type { NodeFactory } from './types.js';
import { syntraJdProcess, syntraResumeProcess, syntraMatchProcess } from './syntra.js';
import { testResumeNodeA, testResumeNodeB } from './test-resume.js';

/**
 * Node registry (design §4) — behavior lives in code; graph_definitions JSON
 * may only reference these keys via nodes[].impl.
 */
export const nodeRegistry = {
  'syntra.jd.process': (() => syntraJdProcess) as NodeFactory,
  'syntra.resume.process': (() => syntraResumeProcess) as NodeFactory,
  'syntra.match.process': (() => syntraMatchProcess) as NodeFactory,
  // Used only by packages/orchestrator/tests/resume-semantics.test.ts (D4).
  'test.resume.a': (() => testResumeNodeA) as NodeFactory,
  'test.resume.b': (() => testResumeNodeB) as NodeFactory,
} as const satisfies Record<string, NodeFactory>;

export type NodeKey = keyof typeof nodeRegistry;
