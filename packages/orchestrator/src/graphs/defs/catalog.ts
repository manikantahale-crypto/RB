import type { GraphSeed } from '../define-graph.js';
import { syntraJdWorkflow } from './syntra.jd.workflow.def.js';
import { syntraResumeWorkflow } from './syntra.resume.workflow.def.js';
import { syntraMatchWorkflow } from './syntra.match.workflow.def.js';

/**
 * All git-authored graph recipes to seed into graph_definitions.
 * Add new `.def.ts` files here when you create them.
 */
export const graphSeedCatalog: GraphSeed[] = [
  syntraJdWorkflow,
  syntraResumeWorkflow,
  syntraMatchWorkflow,
];
