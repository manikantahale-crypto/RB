import type { ToolCatalogEntry } from "./tool-registry.js";
import { getToolCatalog, listToolKeys } from "./tool-registry.js";
import type { EventCatalogEntry } from "./event-catalog.js";
import { formatEventCatalogForPrompt } from "./event-catalog.js";
import { resolveEdgeLabels } from "./graph-visual-registry.js";
import {
  describeNodesForPrompt,
  type PromptNode,
} from "./describe-node-for-prompt.js";

export type BuildGraphSystemPromptArgs = {
  /**
   * The hand-written catalogue. Kept for callers that have nothing better,
   * and superseded by `nodes` — see below.
   */
  tools?: readonly ToolCatalogEntry[];
  /**
   * Nodes described from `node_registry`, which is generated from the
   * contracts the runtime enforces.
   *
   * PREFER THIS. `tools` is prose somebody typed, and it has drifted from what
   * actually runs: for `syntra.match.process` it calls `jobId` required when
   * it is optional and never mentions `requirement_id`, the field the live
   * ASTRA handoff carries. A model given the wrong field names writes a graph
   * that passes every check and cannot move data through itself.
   */
  nodes?: readonly PromptNode[];
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

/**
 * A rule, and the tools it only makes sense alongside.
 *
 * WHY RULES ARE FILTERED. The catalogue handed to the model is scoped to one
 * application, so a rule naming a tool that application cannot use is worse
 * than noise — several of these instruct the model to build with a specific
 * tool, and telling it to use something absent from its catalogue is asking
 * for a graph that fails validation, or an invented key.
 *
 * A plain string is a rule that always applies.
 */
type Rule = string | { text: string; needs: readonly string[] };

const DEFAULT_RULES: Rule[] = [
  "Do NOT include a type field on nodes — visual types are assigned in code from toolKey.",
  "Output a single JSON object matching the required schema:",
  '  { "nodes": [{ "id", "toolKey", "description" }], "edges": [{ "id", "source", "target", "label" }], "unsupported": [] }',
  "nodes: workflow steps only — never __start__ or __end__ as node ids.",
  "edges: use source/target __start__ and __end__ for graph entry/exit. All other endpoints must be node ids.",
  "label: null for non-branching steps; for branching tools use ONLY the allowed labels listed in the catalog.",
  "The graph MUST include at least one edge from __start__ and at least one edge to __end__.",
  "The graph must be fully connected (no orphan nodes).",
  "Prefer the smallest graph that satisfies the admin request.",
  "Workflow design (tools, order, filters, thresholds) comes from the admin's English — encode it in the graph.",
  "Put admin intent in node.description (human-readable); matching rules/thresholds may also live in node.config.",
  {
    needs: ["syntra.match.process"],
    text: "When the admin asks to filter matches (location, visa, availability, experience), set node.config.hardFilters on syntra.match.process to a JSON array of those names only — e.g. \"skip people who need a visa\" → \"hardFilters\": [\"visa\"]. Never invent objects like {\"visaRequired\": false}.",
  },
  {
    needs: ["syntra.match.process"],
    /**
     * NO SCALE STATED HERE, DELIBERATELY.
     *
     * This rule used to say 0–100 while the contract declared 0–1. That was
     * survivable while the catalogue above was prose — the model had no other
     * number to compare it against. Now the catalogue is generated from the
     * schema and prints `matchThreshold: number 0–1`, so a rule naming a
     * different range contradicts the same prompt three paragraphs later.
     *
     * The rule says WHERE the value goes; the schema says what it may be. It
     * is the one that the runtime actually checks.
     *
     * The wider mismatch is still open: authoring's
     * `parseMatchConfigFromRequest` returns 0–100 and would fail the node's
     * input validation if that path ever stamped a value. Deciding which scale
     * wins is its own ticket.
     */
    text: "When the admin asks for a match score cutoff, set node.config.matchThreshold on syntra.match.process or syntra.continuous.match (bench-wide matching), within the range the node's settings declare.",
  },
  {
    needs: ["syntra.match.process"],
    text: "When the admin asks to rerank (or not), set node.config.rerank true/false on syntra.match.process or syntra.continuous.match.",
  },
  {
    needs: ["syntra.match.process"],
    text: 'Example match config: { "hardFilters": ["visa"], "matchThreshold": 0.8 } — use the scale the node declares, not a percentage.',
  },
  {
    needs: [
      "astra.requirement.quality",
      "orch.branch.decision",
      "astra.requirement.normalize",
      "astra.route.decision",
    ],
    text:
      "For ASTRA intake quality gates: use astra.requirement.quality then orch.branch.decision " +
      "(config.passMin / humanMin) with conditionalEdges map pass|human_review|reject, then " +
      "astra.requirement.normalize and/or human.gate, then astra.route.decision to emit " +
      "syntra.jd.normalized — and STOP THERE. That event is a handoff to another application, " +
      "which starts its own workflow; never continue past it in this graph.",
  },
  // Branching shape is the same whichever application is branching.
  "When branching, include graph.conditionalEdges as an ARRAY of objects, e.g. " +
    '[{ "from": "branch", "router": "branch_key", "map": { "pass": "normalize", "human_review": "human", "reject": "__end__" } }]. ' +
    "Never emit conditionalEdges as a bare object.",
  /**
   * A rule saying ASTRA's tools were shared by anyone who needs intake gating
   * used to sit here. It contradicted the registry outright — all six are
   * `shareable = false` — and it is why the generator returned single graphs
   * spanning two applications. The catalogue is scoped now, so the rule is not
   * merely wrong, it is unnecessary.
   */
  "A workflow belongs to ONE application. Every tool in the catalogue above is either " +
    "this application's own or shared platform capability; if the request needs another " +
    "application's work, end at the event that hands off to it and name the rest in " +
    '"unsupported".',
  {
    needs: ["human.gate"],
    text:
      "For duplicate review or human approval, use human.gate with config.reason (e.g. duplicate_review) " +
      "and a clear node.description. Typical graph: process → detect → gate → merge.",
  },
  {
    needs: [
      "syntra.resume.process",
      "syntra.duplicate.detect",
      "human.gate",
      "syntra.duplicate.merge",
    ],
    text: [
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
    ].join("\n"),
  },
  "CRITICAL: Never invent tools. Never silently pretend you fulfilled something you cannot.",
  'Always include "unsupported": strings naming parts of the request you could NOT implement.',
  'If NOTHING can be built, return ONLY: { "error": "UNSUPPORTED_REQUEST", "message": "...", "unsupported": ["..."] }',
  "Do not include commentary — JSON only.",
  "Never add pseudo-nodes for questions or decisions (e.g. \"Duplicate?\", \"Decision\") — branching is ONLY edge labels on real tool nodes.",
  {
    needs: ["syntra.duplicate.detect", "human.gate", "syntra.duplicate.merge"],
    text: "Duplicate review canonical shape: process (resume) → detect (duplicate) → gate (human) → merge; branches duplicate_found/no_duplicate and approved/rejected on edges.",
  },
];

/**
 * Assemble the LLM system prompt (design §4.3).
 * Catalog + events + rules; admin English goes in the user message.
 */
export function buildGraphSystemPrompt(
  args: BuildGraphSystemPromptArgs,
): string {
  const tools = args.tools ?? getToolCatalog();
  /**
   * One list decides both what is shown and what is permitted. They were
   * separate once — the catalogue could be scoped while the rules still
   * enumerated every key in the system, so the prompt showed ten tools and
   * then said twenty-two were allowed.
   */
  const inScope = new Set(
    args.nodes ? args.nodes.map((n) => n.key) : tools.map((t) => t.key),
  );
  const catalogue = args.nodes
    ? describeNodesForPrompt(args.nodes)
    : formatToolCatalogForPrompt(tools);

  /**
   * The allowed-keys rule is built from the SAME list the catalogue above was
   * built from. It used to enumerate every key in the system regardless — so
   * scoping the catalogue on its own would have produced a prompt showing ten
   * tools and then instructing the model that twenty-two were permitted.
   */
  const rules = [
    "Use ONLY the tools listed above. Never invent a tool name.",
    `Every node.toolKey MUST be exactly one of: ${[...inScope].join(", ")}.`,
    ...DEFAULT_RULES.filter(
      (r) => typeof r === "string" || r.needs.every((k) => inScope.has(k)),
    ).map((r) => (typeof r === "string" ? r : r.text)),
    ...(args.extraRules ?? []),
  ];
  return [
    "You are TEKISHO's workflow graph designer.",
    "You design agent workflows as graphs of real, runnable tools.",
    "The admin never picks tools manually — you choose tools from their English request.",
    "",
    "## Available tools",
    catalogue,
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
