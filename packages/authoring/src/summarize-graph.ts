import type { GraphDefinition } from "./graph-definition.js";
import { TOOL_CATALOG } from "./tool-registry.js";

const IMPL_LABEL: Record<string, string> = Object.fromEntries(
  TOOL_CATALOG.map((t) => {
    // Short label for UI: "Process a job description: …" → first clause
    const short = t.description.split(":")[0]?.trim() || t.key;
    return [t.key, short];
  }),
);

export type WorkflowStepSummary = {
  order: number;
  id: string;
  impl: string;
  label: string;
  /** Extra readable bits from node.config (filters, threshold, …). */
  detail?: string;
};

export type ConditionalBranchSummary = {
  /** Node id this router is attached to */
  fromId: string;
  router: string;
  /** label → target node id (or __end__) */
  branches: Array<{ label: string; target: string }>;
};

export type WorkflowSummary = {
  /** e.g. "1. Process a job description → 2. Score a job × resume match" */
  line: string;
  steps: WorkflowStepSummary[];
  graphKey: string;
  empty: boolean;
  /** Present when the graph has conditionalEdges. */
  conditionalBranches?: ConditionalBranchSummary[];
};

function configDetail(config: Record<string, unknown> | undefined): string | undefined {
  if (!config || typeof config !== "object") return undefined;
  const bits: string[] = [];
  const filters = config.hardFilters;
  if (Array.isArray(filters) && filters.length > 0) {
    bits.push(`filters: ${filters.join(", ")}`);
  }
  if (typeof config.matchThreshold === "number") {
    bits.push(`threshold: ${config.matchThreshold}`);
  }
  if (typeof config.rerank === "boolean") {
    bits.push(config.rerank ? "rerank on" : "rerank off");
  }
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

/**
 * Readable current-workflow view (§9 #4) — not raw JSON.
 * Orders nodes by BFS from __start__ along edges.
 */
export function summarizeGraphWorkflow(
  def: GraphDefinition | null | undefined,
): WorkflowSummary {
  if (!def || !def.nodes?.length) {
    return {
      line: "No workflow generated yet.",
      steps: [],
      graphKey: def?.graphKey ?? "",
      empty: true,
    };
  }

  const adj = new Map<string, string[]>();
  for (const [from, to] of def.edges ?? []) {
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }

  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = ["__start__"];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (next === "__end__" || next === "__start__") continue;
      if (seen.has(next)) continue;
      if (!byId.has(next)) continue;
      seen.add(next);
      ordered.push(next);
      queue.push(next);
    }
  }

  // Any nodes not reached (shouldn't happen if topology valid) — append.
  for (const n of def.nodes) {
    if (!seen.has(n.id)) ordered.push(n.id);
  }

  const steps: WorkflowStepSummary[] = ordered.map((id, i) => {
    const node = byId.get(id)!;
    const detail = configDetail(node.config as Record<string, unknown> | undefined);
    const base = IMPL_LABEL[node.impl] ?? node.impl;
    return {
      order: i + 1,
      id: node.id,
      impl: node.impl,
      label: detail ? `${base} (${detail})` : base,
      detail,
    };
  });

  const conditionalBranches: ConditionalBranchSummary[] | undefined =
    def.conditionalEdges?.map((ce) => ({
      fromId: ce.from,
      router: ce.router,
      branches: Object.entries(ce.map).map(([label, target]) => ({
        label,
        target,
      })),
    }));

  // Annotate step labels that have a branch attached.
  const branchByFrom = new Map(
    (conditionalBranches ?? []).map((b) => [b.fromId, b]),
  );
  const annotatedSteps = steps.map((s) => {
    const branch = branchByFrom.get(s.id);
    if (!branch) return s;
    const branchHint = branch.branches
      .map((b) => `if ${b.label} → ${b.target === "__end__" ? "end" : b.target}`)
      .join(", ");
    return { ...s, label: `${s.label} [${branchHint}]` };
  });

  const line = annotatedSteps.map((s) => `${s.order}. ${s.label}`).join(" → ");

  return {
    line: line || "Empty workflow.",
    steps,
    graphKey: def.graphKey,
    empty: steps.length === 0,
    conditionalBranches: conditionalBranches?.length ? conditionalBranches : undefined,
  };
}

/**
 * Parse agent_versions.artifact_source into a graph definition.
 * Accepts canonical JSON graph; returns null for legacy non-JSON artifacts.
 */
export function parseStoredGraphArtifact(
  source: string | null | undefined,
): GraphDefinition | null {
  if (!source?.trim()) return null;
  try {
    const parsed = JSON.parse(source) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as GraphDefinition).nodes) &&
      Array.isArray((parsed as GraphDefinition).edges)
    ) {
      return parsed as GraphDefinition;
    }
  } catch {
    // not JSON
  }
  return null;
}
