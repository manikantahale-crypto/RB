import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import {
  displayEdgeLabel,
  resolveEdgeTone,
  resolveNodeCopy,
  resolveNodeType,
} from "@tekisho/authoring/src/graph-visual-registry.js";

type GraphNode = GraphDefinition["nodes"][number] & {
  visualType?: "ai_action" | "human_gate";
};

export type GraphToMermaidOptions = {
  /** Appended to every node title (for stress / long-label fixtures). */
  labelSuffix?: string;
};

function mermaidId(id: string): string {
  if (id === "__start__") return "flowStart";
  if (id === "__end__") return "flowEnd";
  const safe = id.replace(/[^a-zA-Z0-9_]/g, "_");
  return safe || "node";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeEdgeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\]/g, ")");
}

function nodeTitle(node: GraphNode): string {
  return resolveNodeCopy(node.impl).title;
}

function mermaidClass(node: GraphNode): "action" | "gate" {
  if (node.visualType === "human_gate") return "gate";
  if (node.visualType === "ai_action") return "action";
  return resolveNodeType(node.impl) === "human_gate" ? "gate" : "action";
}

/**
 * Convert normalized GraphDefinition JSON to Mermaid flowchart TD syntax.
 * Node visual type comes from server visualType or resolveNodeType — never edge count.
 * Tool keys are not shown on the canvas; only plain-language titles.
 */
export function graphToMermaid(
  def: GraphDefinition,
  opts: GraphToMermaidOptions = {},
): string {
  const lines: string[] = ["flowchart TD"];
  const classLines: string[] = [];
  const actionIds: string[] = [];
  const gateIds: string[] = [];
  let edgeIndex = 0;
  const positiveEdgeIndexes: number[] = [];
  const negativeEdgeIndexes: number[] = [];

  lines.push("  flowStart((Start))");
  lines.push("  flowEnd((End))");

  for (const node of def.nodes) {
    const id = mermaidId(node.id);
    const title = nodeTitle(node) + (opts.labelSuffix ?? "");
    // Hidden data attribute for click mapping — no tool key visible to recruiters.
    lines.push(
      `  ${id}["<b>${escapeHtml(title)}</b><span data-graph-node-id="${escapeHtml(
        node.id,
      )}" style='display:none'> </span>"]`,
    );
    const cls = mermaidClass(node);
    if (cls === "gate") gateIds.push(id);
    else actionIds.push(id);
  }

  const conditionalFroms = new Set(
    (def.conditionalEdges ?? []).map((ce) => ce.from),
  );

  for (const [from, to] of def.edges) {
    if (from !== "__start__" && from !== "__end__" && conditionalFroms.has(from)) {
      continue;
    }
    lines.push(`  ${mermaidId(from)} --> ${mermaidId(to)}`);
    edgeIndex += 1;
  }

  for (const ce of def.conditionalEdges ?? []) {
    for (const [label, target] of Object.entries(ce.map)) {
      const display = displayEdgeLabel(label);
      lines.push(
        `  ${mermaidId(ce.from)} -- ${escapeEdgeLabel(display)} --> ${mermaidId(target)}`,
      );
      const tone = resolveEdgeTone(label);
      if (tone === "positive") positiveEdgeIndexes.push(edgeIndex);
      if (tone === "negative") negativeEdgeIndexes.push(edgeIndex);
      edgeIndex += 1;
    }
  }

  lines.push(
    "  classDef startend fill:#14161c,color:#fff,stroke:#14161c,font-weight:bold",
  );
  lines.push(
    "  classDef action fill:#fff,stroke:#e4e6eb,stroke-width:1.5px",
  );
  lines.push(
    "  classDef gate fill:#fff8ec,stroke:#e2a53a,stroke-width:1.5px",
  );
  lines.push("  class flowStart,flowEnd startend");
  if (actionIds.length) classLines.push(`  class ${actionIds.join(",")} action`);
  if (gateIds.length) classLines.push(`  class ${gateIds.join(",")} gate`);
  lines.push(...classLines);

  // Color branch edges to match popover outcome tones.
  for (const i of positiveEdgeIndexes) {
    lines.push(`  linkStyle ${i} stroke:#027a48,stroke-width:2px`);
  }
  for (const i of negativeEdgeIndexes) {
    lines.push(`  linkStyle ${i} stroke:#b42318,stroke-width:2px`);
  }

  return lines.join("\n");
}
