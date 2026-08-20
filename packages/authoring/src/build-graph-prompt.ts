import type { ToolCatalogEntry } from "./tool-registry.js";
import { getToolCatalog, listToolKeys } from "./tool-registry.js";
import type { EventCatalogEntry } from "./event-catalog.js";
import { formatEventCatalogForPrompt } from "./event-catalog.js";
import { resolveEdgeLabels } from "./graph-visual-registry.js";

export type BuildGraphSystemPromptArgs = {
  tools?: readonly ToolCatalogEntry[];
  events: EventCatalogEntry[];
  /** Extra rules appended after the defaults. */
  extraRules?: string[];
};

function formatToolCatalogForPrompt(tools: readonly ToolCatalogEntry[]): string {
  return tools
    .map((t) => {
      const inputs = Object.entries(t.input)
        .map(([k, v]) => `    - ${k}: ${v}`)
        .join("\n");
      const branchLabels = resolveEdgeLabels(t.key);
      const branchLine = branchLabels
        ? `\nBranching labels (use on outgoing edges from this tool): ${branchLabels.join(", ")}`
        : "";
      return [
        `### ${t.key}`,
        t.description,
        `Triggered by: ${t.triggeredBy}`,
        `Input:`,
        inputs,
        `Output event: ${t.output.event} — shape ${t.output.shape}${branchLine}`,
      ].join("\n");
    })
    .join("\n\n");
}

const DEFAULT_RULES = [
  "Use ONLY the tools listed above. Never invent a tool name.",
  `Every node.toolKey MUST be exactly one of: ${listToolKeys().join(", ")}.`,
  "Do NOT include a type field on nodes — visual types are assigned in code from toolKey.",
  "Output a single JSON object matching the required schema:",
  '  { "nodes": [{ "id", "toolKey", "description" }], "edges": [{ "id", "source", "target", "label" }], "unsupported": [] }',
  "nodes: workflow steps only — never __start__ or __end__ as node ids.",
  "edges: use source/target __start__ and __end__ for graph entry/exit. All other endpoints must be node ids.",
  "label: null for non-branching steps; for branching tools use ONLY the allowed labels listed in the catalog.",
  "The graph MUST include at least one edge from __start__ and at least one edge to __end__.",
  "The graph must be fully connected (no orphan nodes).",
  "Prefer the smallest graph that satisfies the admin request.",
  "Put admin intent in node.description (human-readable); matching rules/thresholds are applied separately from policy text.",
  "For duplicate review or human approval, use human.gate with description explaining why review is needed.",
  "Example — process profile, branch on duplicate, human review, merge if approved:",
  JSON.stringify({
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
        description: "Human review for duplicate decision",
      },
      {
        id: "merge",
        toolKey: "syntra.duplicate.merge",
        description: "Merge approved duplicate profiles",
      },
    ],
    edges: [
      { id: "e0", source: "__start__", target: "process", label: null },
      { id: "e1", source: "process", target: "detect", label: null },
      {
        id: "e2",
        source: "detect",
        target: "gate",
        label: "duplicate_found",
      },
      { id: "e3", source: "detect", target: "__end__", label: "no_duplicate" },
      { id: "e4", source: "gate", target: "merge", label: "approved" },
      { id: "e5", source: "gate", target: "__end__", label: "rejected" },
      { id: "e6", source: "merge", target: "__end__", label: null },
    ],
    unsupported: [],
  }),
  "CRITICAL: Never invent tools. Never silently pretend you fulfilled something you cannot.",
  'Always include "unsupported": strings naming parts of the request you could NOT implement.',
  'If NOTHING can be built, return ONLY: { "error": "UNSUPPORTED_REQUEST", "message": "...", "unsupported": ["..."] }',
  "Do not include commentary — JSON only.",
  "Never add pseudo-nodes for questions or decisions (e.g. \"Duplicate?\", \"Decision\") — branching is ONLY edge labels on real tool nodes.",
  "Duplicate review canonical shape: process (resume) → detect (duplicate) → gate (human) → merge; branches duplicate_found/no_duplicate and approved/rejected on edges.",
];

/**
 * Assemble the LLM system prompt (design §4.3).
 * Catalog + events + rules; admin English goes in the user message.
 */
export function buildGraphSystemPrompt(
  args: BuildGraphSystemPromptArgs,
): string {
  const tools = args.tools ?? getToolCatalog();
  const rules = [...DEFAULT_RULES, ...(args.extraRules ?? [])];
  return [
    "You are TEKISHO's workflow graph designer.",
    "You design agent workflows as graphs of real, runnable tools.",
    "The admin never picks tools manually — you choose tools from their English request.",
    "",
    "## Available tools",
    formatToolCatalogForPrompt(tools),
    "",
    "## Related events (connective tissue)",
    formatEventCatalogForPrompt(args.events),
    "",
    "## Rules",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
  ].join("\n");
}

/** Short UI hint for the freeform request box (§9 #3). */
export const GENERATE_REQUEST_HINT =
  "Describe using the steps above — e.g. process the resume, then match with location filter and score 70.";

/** Layer 4 — ground admin expectations above the description box. */
export const AGENT_CAPABILITIES_LINE =
  "Today this agent can: process job descriptions, process resumes, and score matches (with location/visa/availability/experience filters and a score threshold). Email, Slack, and more are coming later.";
