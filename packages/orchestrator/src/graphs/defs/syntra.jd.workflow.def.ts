import { defineGraph } from '../define-graph.js';

/** Syntra JD workflow — recipe authored in git, seeded into graph_definitions. */
export const syntraJdWorkflow = defineGraph(
  {
    graphKey: 'syntra.jd.workflow',
    nodes: [{ id: 'process', impl: 'syntra.jd.process' }],
    edges: [
      ['__start__', 'process'],
      ['process', '__end__'],
    ],
  },
  { id: 'graph_syntra_jd_v1', version: 1, status: 'active' },
);
