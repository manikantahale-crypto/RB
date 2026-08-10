import { defineGraph } from '../define-graph.js';

/** Syntra match workflow — recipe authored in git, seeded into graph_definitions. */
export const syntraMatchWorkflow = defineGraph(
  {
    graphKey: 'syntra.match.workflow',
    nodes: [{ id: 'process', impl: 'syntra.match.process' }],
    edges: [
      ['__start__', 'process'],
      ['process', '__end__'],
    ],
  },
  { id: 'graph_syntra_match_v1', version: 1, status: 'active' },
);
