import type { CompileLogEntry } from "./compile-llm-proposal.js";
import type { LlmGraphProposal } from "./llm-graph-proposal-schema.js";

const START = "__start__";
const END = "__end__";

/**
 * Canonical duplicate-review DAG — no synthetic "Duplicate?" / "Decision" nodes.
 * Branching is expressed only via labeled edges from detect + gate tool nodes.
 */
export const CANONICAL_DUPLICATE_REVIEW: LlmGraphProposal = {
  nodes: [
    {
      id: "process",
      toolKey: "syntra.resume.process",
      description: "Process incoming resume profile",
    },
    {
      id: "detect",
      toolKey: "syntra.duplicate.detect",
      description: "Check for duplicate candidates",
    },
    {
      id: "gate",
      toolKey: "human.gate",
      description: "Pause workflow for human review",
    },
    {
      id: "merge",
      toolKey: "syntra.duplicate.merge",
      description: "Merge approved duplicate profiles",
    },
  ],
  edges: [
    { id: "e0", source: START, target: "process", label: null },
    { id: "e1", source: "process", target: "detect", label: null },
    { id: "e2", source: "detect", target: "gate", label: "duplicate_found" },
    { id: "e3", source: "detect", target: END, label: "no_duplicate" },
    { id: "e4", source: "gate", target: "merge", label: "approved" },
    { id: "e5", source: "gate", target: END, label: "rejected" },
    { id: "e6", source: "merge", target: END, label: null },
  ],
  unsupported: [],
};

function logEntry(log: CompileLogEntry[] | undefined, entry: CompileLogEntry) {
  log?.push(entry);
}

function isDuplicateReviewIntent(proposal: LlmGraphProposal): boolean {
  const tools = new Set(proposal.nodes.map((n) => n.toolKey));
  return (
    tools.has("syntra.resume.process") &&
    tools.has("syntra.duplicate.detect") &&
    tools.has("human.gate")
  );
}

/**
 * When the LLM emits duplicate-review tools (often with extra pseudo-decision nodes),
 * rewrite to the single canonical 4-node topology. Descriptions are preserved from
 * the first matching toolKey when present.
 */
export function canonicalizeDuplicateReviewProposal(
  proposal: LlmGraphProposal,
  log?: CompileLogEntry[],
): LlmGraphProposal {
  if (!isDuplicateReviewIntent(proposal)) return proposal;

  const pickDesc = (toolKey: string, fallback: string) =>
    proposal.nodes.find((n) => n.toolKey === toolKey)?.description ?? fallback;

  logEntry(log, {
    kind: "canonicalize_topology",
    detail:
      "duplicate-review workflow rewritten to canonical 4-node DAG (branches on edges only)",
  });

  return {
    ...CANONICAL_DUPLICATE_REVIEW,
    nodes: CANONICAL_DUPLICATE_REVIEW.nodes.map((n) => ({
      ...n,
      description: pickDesc(n.toolKey, n.description),
    })),
    unsupported: proposal.unsupported ?? [],
  };
}
