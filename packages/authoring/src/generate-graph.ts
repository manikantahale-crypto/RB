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
    // ASTRA route defaults (Option B bridge) — same as graph_definitions seed.
    if (n.impl === "astra.route.decision") {
      if (config.onActionable === undefined) {
        config.onActionable = "syntra.jd.normalized";
      }
      if (config.onRejected === undefined) {
        config.onRejected = "astra.requirement.rejected";
      }
      if (config.minConfidence === undefined) {
        config.minConfidence = 0;
      }
    }
    // Branch planner defaults for human-loop conditioning.
    if (n.impl === "orch.branch.decision") {
      if (config.passMin === undefined) config.passMin = 0.6;
      if (config.humanMin === undefined) config.humanMin = 0.35;
      if (config.onRejectEvent === undefined) {
        config.onRejectEvent = "astra.requirement.rejected";
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
    ...(template.conditionalEdges && template.conditionalEdges.length > 0
      ? { conditionalEdges: template.conditionalEdges }
      : {}),
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
 * When hardFilters is a non-empty array, stamp them onto the `match` node
 * config (no separate filter impl — authoring only uses runtime nodeRegistry).
 */
function applyHardFilters(graph: MutableGraph, policy: AgentPolicy): void {
  const filters = policy.hardFilters;
  if (!Array.isArray(filters) || filters.length === 0) {
    return;
  }

  const matchNode = graph.nodes.find((n) => n.id === "match");
  if (matchNode) {
    matchNode.config = { ...(matchNode.config ?? {}), hardFilters: filters };
    return;
  }

  const first = graph.nodes[0];
  if (first) {
    first.config = { ...(first.config ?? {}), hardFilters: filters };
  }
}

