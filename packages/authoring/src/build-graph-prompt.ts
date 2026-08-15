import type { ToolCatalogEntry } from "./tool-registry.js";
import { getToolCatalog } from "./tool-registry.js";
import type { EventCatalogEntry } from "./event-catalog.js";
import { formatEventCatalogForPrompt } from "./event-catalog.js";

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
      return [
        `### ${t.key}`,
        t.description,
        `Triggered by: ${t.triggeredBy}`,
        `Input:`,
        inputs,
        `Output event: ${t.output.event} — shape ${t.output.shape}`,
      ].join("\n");
    })
    .join("\n\n");
}

const DEFAULT_RULES = [
  "Use ONLY the tools listed above. Never invent a tool name.",
  "Every node.impl MUST be exactly one of the tool keys.",
  "Output a single JSON object (no markdown fences) with this shape:",
  '  { "graphKey": string, "nodes": [{ "id": string, "impl": string, "config"?: object }], "edges": [[string, string], ...] }',
  "The graph MUST include edges from __start__ into the workflow and out to __end__.",
  "The graph must be fully connected (no orphan nodes).",
  "Prefer the smallest graph that satisfies the admin request.",
  "Workflow design (tools, order, filters, thresholds) comes from the admin's English — encode it in the graph.",
  "When the admin asks to filter matches (location, visa, availability, experience), set node.config.hardFilters on syntra.match.process to a JSON array of those names only — e.g. \"skip people who need a visa\" → \"hardFilters\": [\"visa\"]. Never invent objects like {\"visaRequired\": false}.",
  "When the admin asks for a match score cutoff, set node.config.matchThreshold (0–100) on syntra.match.process.",
  "When the admin asks to rerank (or not), set node.config.rerank true/false on syntra.match.process.",
  "Example match config: { \"hardFilters\": [\"visa\"], \"matchThreshold\": 80 }",
  "For duplicate review or human approval, use human.gate with config.reason (e.g. duplicate_review). " +
    "Typical graph: single human.gate node for syntra.duplicate.review_required triggers.",
  "CRITICAL: Never invent tools. Never silently pretend you fulfilled something you cannot.",
  "Always include an \"unsupported\" array (may be empty): strings naming parts of the admin request you could NOT implement with the tools above (e.g. \"email\", \"Slack\").",
  'Output shape: { "graphKey": string, "nodes": [...], "edges": [...], "unsupported": string[] }',
  "If NOTHING in the request can be built with these tools, return ONLY: " +
    '{ "error": "UNSUPPORTED_REQUEST", "message": "<short reason>", "unsupported": ["..."] }',
  "Do not include commentary — JSON only.",
  "Keep the JSON compact (short node ids, minimal config) so it fits in one response.",
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
    "The admin never picks tools manually — you choose tools and config from their English request.",
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
