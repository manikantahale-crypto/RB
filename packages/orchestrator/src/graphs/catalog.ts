import { defineGraph, type GraphSeed } from './recipe.js';

/**
 * Live recipes only (seeded into graph_definitions at boot).
 * Share / interview removed from catalog until product events exist.
 */
export const graphSeedCatalog: GraphSeed[] = [
  defineGraph(
    {
      graphKey: 'syntra.jd.workflow',
      agentName: 'matching-agent',
      nodes: [
        {
          id: 'process',
          impl: 'syntra.jd.process',
          config: { actionClass: 'INTERNAL_WRITE' },
        },
      ],
      edges: [
        ['__start__', 'process'],
        ['process', '__end__'],
      ],
    },
    { id: 'graph_syntra_jd_v1', version: 1, status: 'active' },
  ),
  defineGraph(
    {
      graphKey: 'syntra.match.workflow',
      agentName: 'matching-agent',
      nodes: [
        {
          id: 'process',
          impl: 'syntra.match.process',
          config: { actionClass: 'INTERNAL_WRITE' },
        },
      ],
      edges: [
        ['__start__', 'process'],
        ['process', '__end__'],
      ],
    },
    { id: 'graph_syntra_match_v1', version: 1, status: 'active' },
  ),
  // Syntra UI polls resumes/candidates for processingStatus=processed.
  // Route through Syntra HTTP (same as JD/match) so product rows update.
  defineGraph(
    {
      graphKey: 'resume.intake',
      agentName: 'intake-agent',
      stateSchema: 'ResumeIntakeState',
      entryInput: 'ResumeReceivedPayload',
      nodes: [
        {
          id: 'process',
          impl: 'syntra.resume.process',
          config: { actionClass: 'INTERNAL_WRITE' },
        },
      ],
      edges: [
        ['__start__', 'process'],
        ['process', '__end__'],
      ],
    },
    { id: 'graph_resume_intake_v1', version: 1, status: 'active' },
  ),
  defineGraph(
    {
      graphKey: 'duplicate.review',
      agentName: 'intake-agent',
      nodes: [
        {
          id: 'gate',
          impl: 'human.gate',
          config: { reason: 'duplicate_review', actionClass: 'CONTROL' },
        },
      ],
      edges: [
        ['__start__', 'gate'],
        ['gate', '__end__'],
      ],
    },
    { id: 'graph_duplicate_review_v1', version: 1, status: 'active' },
  ),
];
