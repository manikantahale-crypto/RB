import { CANONICAL_DUPLICATE_REVIEW } from "@tekisho/authoring/src/canonicalize-workflows.js";
import { compileLlmProposalToGraph } from "@tekisho/authoring/src/compile-llm-proposal.js";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";

export type WorkflowFixtureId = "duplicate-review" | "long-labels";

export function duplicateReviewGraph(): GraphDefinition {
  return compileLlmProposalToGraph(CANONICAL_DUPLICATE_REVIEW, {
    graphKey: "fixture.duplicate-review",
  });
}

export function longLabelsGraph(): GraphDefinition {
  return duplicateReviewGraph();
}

/** Long-label stress is applied at render time via graphToMermaid labelSuffix. */
export const LONG_LABEL_SUFFIX =
  " — extended validation pass with additional duplicate-detection heuristics " +
  "and cross-profile reconciliation checks for production-scale intake volume";

export function getWorkflowFixture(id: string | undefined): {
  graph: GraphDefinition;
  labelSuffix?: string;
} {
  switch (id) {
    case "long-labels":
      return { graph: longLabelsGraph(), labelSuffix: LONG_LABEL_SUFFIX };
    case "duplicate-review":
    default:
      return { graph: duplicateReviewGraph() };
  }
}
