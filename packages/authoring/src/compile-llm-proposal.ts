import type { GraphDefinition } from "./graph-definition.js";
import type { LlmGraphEdge, LlmGraphProposal } from "./llm-graph-proposal-schema.js";
import {
  isBranchingTool,
  isEndVisualTool,
  resolveEdgeLabels,
  resolveNodeType,
  resolveRouterKey,
} from "./graph-visual-registry.js";
import { isRegisteredTool } from "./tool-registry.js";
import { canonicalizeDuplicateReviewProposal } from "./canonicalize-workflows.js";

const START = "__start__";
const END = "__end__";

export type CompileLogEntry = {
  kind:
    | "strip_node"
    | "strip_edge"
    | "strip_edge_label"
    | "collapse_end"
    | "canonicalize_topology";
  detail: string;
};

export type CompileLlmProposalOptions = {
  graphKey: string;
  log?: CompileLogEntry[];
};

export type GraphStructuralFingerprint = {
  nodes: Array<{ id: string; toolKey: string; config?: Record<string, unknown> }>;
  plainEdges: Array<[string, string]>;
  conditionalEdges: Array<{
    from: string;
    router: string;
    map: Record<string, string>;
  }>;
};

/** Cosmetic-free structural identity for determinism tests. */
export function graphStructuralFingerprint(
  def: GraphDefinition,
): GraphStructuralFingerprint {
  const nodes = def.nodes
    .map((n) => ({
      id: n.id,
      toolKey: n.impl,
      ...(n.config && Object.keys(n.config).length > 0 ? { config: n.config } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const plainEdges = [...def.edges].sort((a, b) =>
    `${a[0]}->${a[1]}`.localeCompare(`${b[0]}->${b[1]}`),
  );

  const conditionalEdges = (def.conditionalEdges ?? [])
    .map((ce) => ({
      from: ce.from,
      router: ce.router,
      map: Object.fromEntries(
        Object.entries(ce.map).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }))
    .sort((a, b) =>
      `${a.from}:${a.router}`.localeCompare(`${b.from}:${b.router}`),
    );

  return { nodes, plainEdges, conditionalEdges };
}

function logEntry(log: CompileLogEntry[] | undefined, entry: CompileLogEntry) {
  log?.push(entry);
}

function isEndpoint(id: string): boolean {
  return id === START || id === END;
}

/** Strip invalid nodes/edges before compile. */
export function normalizeLlmProposal(
  proposal: LlmGraphProposal,
  log?: CompileLogEntry[],
): LlmGraphProposal {
  const seenIds = new Set<string>();
  const nodes = proposal.nodes
    .filter((n) => {
      if (!isRegisteredTool(n.toolKey)) {
        logEntry(log, {
          kind: "strip_node",
          detail: `unknown toolKey "${n.toolKey}" on node "${n.id}"`,
        });
        return false;
      }
      if (n.id === START || n.id === END) {
        logEntry(log, {
          kind: "strip_node",
          detail: `sentinel id "${n.id}" is not a valid node`,
        });
        return false;
      }
      if (seenIds.has(n.id)) {
        logEntry(log, {
          kind: "strip_node",
          detail: `duplicate node id "${n.id}"`,
        });
        return false;
      }
      seenIds.add(n.id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges = proposal.edges.filter((e) => {
    const sourceOk = e.source === START || nodeIds.has(e.source);
    const targetOk = e.target === END || nodeIds.has(e.target);
    if (!sourceOk || !targetOk) {
      logEntry(log, {
        kind: "strip_edge",
        detail: `edge "${e.id}" references missing node (${e.source} → ${e.target})`,
      });
      return false;
    }
    if (e.source === END) {
      logEntry(log, {
        kind: "strip_edge",
        detail: `edge "${e.id}" has invalid source __end__`,
      });
      return false;
    }
    if (e.target === START) {
      logEntry(log, {
        kind: "strip_edge",
        detail: `edge "${e.id}" has invalid target __start__`,
      });
      return false;
    }
    return true;
  });

  return {
    ...proposal,
    nodes,
    edges,
    unsupported: proposal.unsupported ?? [],
  };
}

/**
 * Collapse multiple end-visual sink nodes into one canonical node (deterministic).
 * Only applies to nodes whose toolKey maps to visual type "end".
 */
export function collapseEndVisualNodes(
  proposal: LlmGraphProposal,
  log?: CompileLogEntry[],
): LlmGraphProposal {
  const nodeIds = new Set(proposal.nodes.map((n) => n.id));
  const outDegree = new Map<string, number>();
  for (const id of nodeIds) outDegree.set(id, 0);

  for (const e of proposal.edges) {
    if (!isEndpoint(e.source) && nodeIds.has(e.source)) {
      outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
    }
  }

  const endVisualNodes = proposal.nodes
    .filter((n) => isEndVisualTool(n.toolKey) && (outDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (endVisualNodes.length <= 1) return proposal;

  const canonical = endVisualNodes[0]!;
  const removed = new Set(endVisualNodes.slice(1).map((n) => n.id));

  for (const id of removed) {
    logEntry(log, {
      kind: "collapse_end",
      detail: `merged end node "${id}" into canonical "${canonical.id}"`,
    });
  }

  const nodes = proposal.nodes.filter((n) => !removed.has(n.id));
  const edges = proposal.edges.map((e) => ({
    ...e,
    source: removed.has(e.source) ? canonical.id : e.source,
    target: removed.has(e.target) ? canonical.id : e.target,
  }));

  return { ...proposal, nodes, edges };
}

function filterEdgeLabels(
  proposal: LlmGraphProposal,
  log?: CompileLogEntry[],
): LlmGraphEdge[] {
  const toolByNodeId = new Map(proposal.nodes.map((n) => [n.id, n.toolKey]));
  const kept: LlmGraphEdge[] = [];

  for (const edge of proposal.edges) {
    if (isEndpoint(edge.source)) {
      if (edge.label !== null) {
        logEntry(log, {
          kind: "strip_edge_label",
          detail: `edge "${edge.id}" from ${edge.source} must be unlabeled`,
        });
      }
      kept.push({ ...edge, label: null });
      continue;
    }

    const toolKey = toolByNodeId.get(edge.source);
    if (!toolKey) continue;

    const allowed = resolveEdgeLabels(toolKey);
    if (allowed) {
      if (edge.label === null) {
        logEntry(log, {
          kind: "strip_edge",
          detail: `branching edge "${edge.id}" from "${edge.source}" missing label`,
        });
        continue;
      }
      if (!allowed.includes(edge.label)) {
        logEntry(log, {
          kind: "strip_edge_label",
          detail: `edge "${edge.id}" label "${edge.label}" not allowed for ${toolKey} (allowed: ${allowed.join(", ")})`,
        });
        continue;
      }
      kept.push(edge);
      continue;
    }

    if (edge.label !== null) {
      logEntry(log, {
        kind: "strip_edge_label",
        detail: `edge "${edge.id}" from non-branching "${edge.source}" had label "${edge.label}" — stripped`,
      });
    }
    kept.push({ ...edge, label: null });
  }

  return kept;
}

/**
 * Convert a validated LLM proposal into a runtime GraphDefinition.
 * Node visual types and routers are derived from toolKey — never from LLM metadata.
 */
export function compileLlmProposalToGraph(
  raw: LlmGraphProposal,
  opts: CompileLlmProposalOptions,
): GraphDefinition {
  const log = opts.log;
  let proposal = canonicalizeDuplicateReviewProposal(raw, log);
  proposal = normalizeLlmProposal(proposal, log);
  proposal = collapseEndVisualNodes(proposal, log);

  const edges = filterEdgeLabels(proposal, log);
  const toolByNodeId = new Map(proposal.nodes.map((n) => [n.id, n.toolKey]));

  // Resolve visual types (for validation/logging — GraphDefinition stores impl only).
  for (const node of proposal.nodes) {
    resolveNodeType(node.toolKey);
  }

  const plainEdges: [string, string][] = [];
  const conditionalByFrom = new Map<
    string,
    { router: string; map: Record<string, string> }
  >();

  for (const edge of edges) {
    if (isEndpoint(edge.source)) {
      plainEdges.push([edge.source, edge.target]);
      continue;
    }

    const toolKey = toolByNodeId.get(edge.source)!;
    if (isBranchingTool(toolKey) && edge.label !== null) {
      const router = resolveRouterKey(toolKey);
      if (!router) continue;
      let entry = conditionalByFrom.get(edge.source);
      if (!entry) {
        entry = { router, map: {} };
        conditionalByFrom.set(edge.source, entry);
      }
      entry.map[edge.label] = edge.target;
      continue;
    }

    plainEdges.push([edge.source, edge.target]);
  }

  const conditionalEdges =
    conditionalByFrom.size > 0
      ? [...conditionalByFrom.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([from, { router, map }]) => ({
            from,
            router,
            map: Object.fromEntries(
              Object.entries(map).sort(([a], [b]) => a.localeCompare(b)),
            ),
          }))
      : undefined;

  return {
    graphKey: opts.graphKey,
    nodes: proposal.nodes.map((n) => {
      const visualType = resolveNodeType(n.toolKey);
      return {
        id: n.id,
        impl: n.toolKey,
        ...(visualType === "human_gate" || visualType === "ai_action"
          ? { visualType }
          : {}),
      };
    }),
    edges: plainEdges,
    ...(conditionalEdges?.length ? { conditionalEdges } : {}),
  };
}
