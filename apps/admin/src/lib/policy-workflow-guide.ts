import { getToolCatalog } from "@tekisho/authoring/src/tool-registry.js";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import type { GenerationTrace } from "@tekisho/authoring/src/generation-meta.js";
import { summarizeGraphWorkflow } from "@tekisho/authoring/src/summarize-graph.js";

export type PlannedStep = {
  order: number;
  nodeId: string;
  toolKey: string;
  label: string;
  policyApplies: string;
};

export type StepExplanationSource = "confirmed" | "heuristic";

export type StepExplanation = {
  step: string;
  node: string;
  tool: string;
  fromPolicy: string;
  source: StepExplanationSource;
};

const TOOL_BY_KEY = Object.fromEntries(
  getToolCatalog().map((t) => [t.key, t]),
);

/** Plain-language guide for what template generate will build (before clicking Create workflow). */
export function buildPlannedSteps(
  template: {
    nodes?: Array<{ id: string; impl: string }>;
    wiring?: Array<[string, string]>;
  } | null | undefined,
): PlannedStep[] {
  if (!template?.nodes?.length) return [];

  const order = orderNodesFromWiring(
    template.nodes,
    template.wiring ?? [],
    (template as { conditionalEdges?: Array<{ from: string; map: Record<string, string> }> })
      .conditionalEdges,
  );
  return order.map((node, idx) => {
    const tool = TOOL_BY_KEY[node.impl];
    return {
      order: idx + 1,
      nodeId: node.id,
      toolKey: node.impl,
      label: tool?.description.split(":")[0]?.trim() ?? node.impl,
      policyApplies: policyHintForNode(node.id, node.impl),
    };
  });
}

function orderNodesFromWiring(
  nodes: Array<{ id: string; impl: string }>,
  wiring: Array<[string, string]>,
  conditionalEdges?: Array<{ from: string; map: Record<string, string> }>,
): Array<{ id: string; impl: string }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const [from, to] of wiring) {
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  for (const ce of conditionalEdges ?? []) {
    const list = adj.get(ce.from) ?? [];
    for (const dest of Object.values(ce.map ?? {})) list.push(dest);
    adj.set(ce.from, list);
  }
  const ordered: Array<{ id: string; impl: string }> = [];
  const seen = new Set<string>();
  const queue = ["__start__"];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (next === "__end__" || seen.has(next)) continue;
      const n = byId.get(next);
      if (!n) continue;
      seen.add(next);
      ordered.push(n);
      queue.push(next);
    }
  }
  return ordered.length ? ordered : [...nodes];
}

function policyHintForNode(_nodeId: string, impl: string): string {
  if (impl === "syntra.jd.process") {
    return "Will process job descriptions when you create a workflow.";
  }
  if (impl === "syntra.resume.process") {
    return "Will process resumes / profiles when you create a workflow.";
  }
  if (impl === "syntra.match.process") {
    return "Match settings (threshold, filters) appear after you create a workflow.";
  }
  if (impl === "astra.requirement.quality") {
    return "Scores JD quality (confidence_score) before branching.";
  }
  if (impl === "orch.branch.decision") {
    return "Plans pass / human_review / reject from passMin & humanMin vs confidence_score.";
  }
  if (impl === "astra.requirement.normalize") {
    return "Full ASTRA enrich via Syntra before routing to matching.";
  }
  if (impl === "astra.route.decision") {
    return "Emits syntra.jd.normalized for SYNTRA, or astra.requirement.rejected.";
  }
  if (impl === "astra.requirement.intake" || impl === "astra.requirement.ingest") {
    return "Creates a requirement in Syntra (email or API channel).";
  }
  if (impl === "astra.jobboard.fetch") {
    return "Pulls job-board listings into ASTRA / Syntra.";
  }
  if (impl === "human.gate") {
    return "Human review step — pause until approve/reject resume.";
  }
  return "Step shape from this agent’s template until you create a workflow.";
}

export type WorkflowPhase =
  | "no_policy"
  | "draft_saved"
  | "generating"
  | "preview_pending"
  | "graph_ready"
  | "policy_changed"
  | "going_live"
  | "live"
  | "error";

export function deriveWorkflowPhase(args: {
  policyText: string;
  status: string | null;
  ui: string;
  hasGraph: boolean;
  policyDirty: boolean;
  hasUnsavedPreview?: boolean;
}): WorkflowPhase {
  if (args.ui === "generating") return "generating";
  if (args.hasUnsavedPreview || args.ui === "preview") return "preview_pending";
  if (args.ui === "going_live") return "going_live";
  if (args.status === "active") return "live";
  if (args.ui === "server" || args.ui === "validation") return "error";
  if (!args.policyText.trim()) return "no_policy";
  if (args.policyDirty && args.hasGraph) return "policy_changed";
  if (args.hasGraph) return "graph_ready";
  if (args.status === "draft" || args.policyText.trim()) return "draft_saved";
  return "no_policy";
}

export function phaseLabel(phase: WorkflowPhase): string {
  switch (phase) {
    case "no_policy":
      return "Write your policy";
    case "draft_saved":
      return "Policy saved — create workflow next";
    case "generating":
      return "Building workflow from your policy…";
    case "preview_pending":
      return "Preview ready — not saved yet (Accept & save required)";
    case "graph_ready":
      return "Workflow saved — review below, then make live";
    case "policy_changed":
      return "Policy changed — update workflow to refresh the graph";
    case "going_live":
      return "Making live (compile → publish → activate)…";
    case "live":
      return "Live in production";
    case "error":
      return "Needs attention";
    default:
      return "";
  }
}

/** Read confirmed settings from a generated node's config (source of truth). */
export function describeStepFromGraph(
  node: { id: string; impl: string; config?: Record<string, unknown> },
): string | null {
  const cfg = node.config;
  if (!cfg || typeof cfg !== "object") return null;

  const bits: string[] = [];

  if (node.impl === "syntra.match.process") {
    if (typeof cfg.matchThreshold === "number") {
      bits.push(`Match threshold: ${cfg.matchThreshold}`);
    }
    if (typeof cfg.rerank === "boolean") {
      bits.push(`Rerank: ${cfg.rerank ? "on" : "off"}`);
    }
    if (Array.isArray(cfg.hardFilters) && cfg.hardFilters.length > 0) {
      bits.push(`Hard filters: ${cfg.hardFilters.join(", ")}`);
    }
  }

  if (node.impl === "human.gate") {
    if (typeof cfg.reason === "string" && cfg.reason.trim()) {
      bits.push(`Human review reason: ${cfg.reason.trim()}`);
    }
  }

  if (typeof cfg.prompt === "string" && cfg.prompt.trim()) {
    const p = cfg.prompt.trim();
    bits.push(
      p.length > 120 ? `Step prompt: ${p.slice(0, 117)}…` : `Step prompt: ${p}`,
    );
  }

  return bits.length > 0 ? bits.join(" · ") : null;
}

/**
 * Explain each workflow step using generated graph config first (confirmed),
 * then keyword heuristics on policy text (clearly marked as unverified).
 */
export function explainGeneratedGraph(
  definition: GraphDefinition | null | undefined,
  policyText: string,
  _trace?: GenerationTrace | null,
): StepExplanation[] {
  const summary = summarizeGraphWorkflow(definition ?? null);
  if (summary.empty || !definition) return [];

  const byId = new Map(definition.nodes.map((n) => [n.id, n]));

  const lines = policyText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  return summary.steps.map((s, i) => {
    const node = byId.get(s.id);
    const confirmed =
      node != null ? describeStepFromGraph(node) : null;

    if (confirmed) {
      return {
        step: `Step ${s.order}`,
        node: s.id,
        tool: s.impl,
        fromPolicy: confirmed,
        source: "confirmed" as const,
      };
    }

    const heuristic =
      matchPolicyLine(lines, s.impl, i) ??
      "No confirmed settings on this step (template defaults only)";

    return {
      step: `Step ${s.order}`,
      node: s.id,
      tool: s.impl,
      fromPolicy: heuristic,
      source: "heuristic" as const,
    };
  });
}

function matchPolicyLine(
  lines: string[],
  impl: string,
  index: number,
): string | null {
  const lower = lines.map((l) => l.toLowerCase());
  if (impl.includes("jd") || impl.includes("job")) {
    const hit = lower.find(
      (l) =>
        l.includes("job") || l.includes("jd") || l.includes("description"),
    );
    if (hit) return lines[lower.indexOf(hit)]!;
  }
  if (impl.includes("resume")) {
    const hit = lower.find((l) => l.includes("resume") || l.includes("profile"));
    if (hit) return lines[lower.indexOf(hit)]!;
  }
  if (impl.includes("match")) {
    const hit = lower.find(
      (l) =>
        l.includes("score") ||
        l.includes("match") ||
        l.includes("threshold") ||
        l.includes("rerank") ||
        l.includes("visa"),
    );
    if (hit) return lines[lower.indexOf(hit)]!;
  }
  if (impl.includes("human.gate") || impl.includes("gate")) {
    const hit = lower.find(
      (l) =>
        l.includes("duplicate") ||
        l.includes("human review") ||
        l.includes("approval"),
    );
    if (hit) return lines[lower.indexOf(hit)]!;
  }
  return lines[index] ?? null;
}

export function friendlyBindingConflict(message: string): string {
  if (!message.includes("already bound")) return message;
  return (
    `${message}\n\n` +
    "In v1 only one agent can own a trigger event at a time. " +
    "To make this agent live on the same event, first make the other agent not live " +
    "(or change this agent’s trigger in a future version). " +
    "Your new graph is still saved — it is not live until the binding is free."
  );
}
