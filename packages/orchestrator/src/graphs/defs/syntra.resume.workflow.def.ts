import { defineGraph } from '../define-graph.js';

/** Syntra resume workflow — recipe authored in git, seeded into graph_definitions. */
export const syntraResumeWorkflow = defineGraph(
  {
    graphKey: 'syntra.resume.workflow',
    nodes: [{ id: 'process', impl: 'syntra.resume.process' }],
    edges: [
      ['__start__', 'process'],
      ['process', '__end__'],
    ],
  },
  { id: 'graph_syntra_resume_v1', version: 1, status: 'active' },
);
