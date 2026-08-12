import { createHash } from "node:crypto";
import type { AgentTemplate } from "./agent-template.js";
import {
  GraphDefinitionSchema,
  validateGraphTopology,
  type GraphDefinition,
} from "./graph-definition.js";
import { isRegisteredTool } from "./tool-registry.js";
import type { AgentPolicy } from "./validate-policy.js";

export type GenerateGraphResult = {
  /** graph_definitions-shaped topology */
  definition: GraphDefinition;
  /** Canonical JSON artifact stored in agent_versions.artifact_source */
  source: string;
  checksum: string;
  graphKey: string;
};

type MutableGraph = {
  graphKey: string;
  nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
  edges: Array<[string, string]>;
};

/**
 * Schema-driven generator (design §5 / A6):
 * `(AgentPolicy, AgentTemplate) → GraphDefinition`
 *
 * Agent-agnostic: all product-specific structure comes from the template.
 */
export function generateGraphFromTemplate(
  policy: AgentPolicy,
  template: AgentTemplate,
): GenerateGraphResult {
  const fields: string[] = [];

  for (const node of template.nodes) {
    if (!isRegisteredTool(node.impl)) {
      fields.push(node.impl);
    }
  }
  if (fields.length > 0) {
    throw new Error(
      `GENERATION_FAILED: template references unknown impl(s): ${fields.join(", ")}`,
    );
  }

  const graphKey = `${template.agentKey}.authored`;
  const sharedPolicyConfig: Record<string, unknown> = {
    retry: policy.retry,
    escalation: policy.escalation,
    guardrails: policy.guardrails,
  };
  if (typeof policy.prompt === "string") {
    sharedPolicyConfig.prompt = policy.prompt;
  }

  const nodes: MutableGraph["nodes"] = template.nodes.map((n) => {
    const config: Record<string, unknown> = { ...sharedPolicyConfig };
    if (n.configFrom) {
      for (const key of n.configFrom) {
        if (policy[key] !== undefined) {
          config[key] = policy[key];
        }
      }
    }
    return { id: n.id, impl: n.impl, config };
  });

  const edges: MutableGraph["edges"] = template.wiring.map(
    ([a, b]) => [a, b] as [string, string],
  );

  const graph: MutableGraph = { graphKey, nodes, edges };

  applyConditionals(graph, policy, template);

  const definition = GraphDefinitionSchema.parse({
    graphKey: graph.graphKey,
    nodes: graph.nodes,
    edges: graph.edges,
  });
  validateGraphTopology(definition);

  const source = `${JSON.stringify(definition, null, 2)}\n`;
  const checksum = createHash("sha256").update(source).digest("hex");

  return { definition, source, checksum, graphKey };
}

/**
 * Apply template.conditionalOn using known policy keys (design §5A).
 * Unknown keys are ignored (template docs may carry human-readable notes).
 */
function applyConditionals(
  graph: MutableGraph,
  policy: AgentPolicy,
  template: AgentTemplate,
): void {
  for (const key of Object.keys(template.conditionalOn)) {
    if (key === "hardFilters") {
      applyHardFilters(graph, policy);
    }
  }
}

/**
 * When hardFilters is a non-empty array, insert a filter node before `match`
 * (design §5A example).
 */
function applyHardFilters(graph: MutableGraph, policy: AgentPolicy): void {
  const filters = policy.hardFilters;
  if (!Array.isArray(filters) || filters.length === 0) {
    return;
  }

  const matchId = graph.nodes.find((n) => n.id === "match")?.id;
  if (!matchId) {
    // No match node — stamp filters onto first node config instead.
    const first = graph.nodes[0];
    if (first) {
      first.config = { ...(first.config ?? {}), hardFilters: filters };
    }
    return;
  }

  if (graph.nodes.some((n) => n.id === "filter")) {
    const existing = graph.nodes.find((n) => n.id === "filter")!;
    existing.config = { ...(existing.config ?? {}), hardFilters: filters };
    return;
  }

  const matchNode = graph.nodes.find((n) => n.id === matchId)!;
  graph.nodes.push({
    id: "filter",
    impl: "hard_filter",
    config: {
      ...(matchNode.config ?? {}),
      hardFilters: filters,
    },
  });

  // Rewire: any edge *→ match becomes *→ filter; add filter → match
  const nextEdges: Array<[string, string]> = [];
  for (const [from, to] of graph.edges) {
    if (to === matchId) {
      nextEdges.push([from, "filter"]);
    } else {
      nextEdges.push([from, to]);
    }
  }
  nextEdges.push(["filter", matchId]);
  graph.edges = nextEdges;
}

