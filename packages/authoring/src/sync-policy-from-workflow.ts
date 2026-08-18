import type { GraphDefinition } from "./graph-definition.js";
import { isRegisteredTool } from "./tool-registry.js";
import { getPath, setPath, type PolicyFieldDesc } from "./policy-ext-ui.js";

const WORKFLOW_SECTION_RE = /\n\nWorkflow steps:\s*[\n\S]*/i;
/** Trailing arrow chains, e.g. "1. Process a job → 2. Process resume → 3. Score…" */
const ARROW_WORKFLOW_TAIL_RE =
  /(?:\n\n|\n)(?:Workflow steps:\s*)?(?:\d+\.\s+[^\n→]+(?:\s*→\s*\d+\.\s+[^\n→]+)+[^\n]*)$/i;

/** Remove legacy appended workflow summary from policy prompt text. */
export function stripWorkflowSectionFromPrompt(prompt: string): string {
  let p = prompt.replace(WORKFLOW_SECTION_RE, "").trim();
  p = p.replace(ARROW_WORKFLOW_TAIL_RE, "").trim();
  p = p.replace(
    /\s*\d+\.\s+[^→\n]+(?:\s*→\s*\d+\.\s+[^→\n]+)+[^\n]*$/i,
    "",
  ).trim();
  return p;
}

function syncThresholdInPrompt(prompt: string, threshold: number): string {
  let p = prompt;
  p = p.replace(
    /(match\s+(?:acceptance\s+)?threshold\s+(?:to|of|:)\s*)\d+/gi,
    `$1${threshold}`,
  );
  p = p.replace(/(threshold\s+(?:to|of|:)\s*)\d+/gi, `$1${threshold}`);
  p = p.replace(/(score\s+(?:of\s+)?(?:at\s+least\s+)?)\d+/gi, `$1${threshold}`);
  return p;
}

function syncRerankInPrompt(prompt: string, rerank: boolean): string {
  if (rerank) {
    if (/rerank/i.test(prompt)) return prompt;
    return `${prompt.trim()}\n\nUse reranking when scoring matches.`.trim();
  }
  return prompt.replace(/\n*Use reranking when scoring matches\.\n*/gi, "\n").trim();
}

/**
 * Merge workflow topology + node config into policy form values
 * (prompt prose, allowedTools, threshold, filters). Does not append arrow step lists.
 */
export function mergeWorkflowIntoPolicyValues(
  values: Record<string, unknown>,
  def: GraphDefinition | null | undefined,
  _fields?: PolicyFieldDesc[],
): Record<string, unknown> {
  if (!def?.nodes?.length) return values;

  let out = { ...values };
  const tools = [
    ...new Set(
      def.nodes.map((n) => n.impl).filter((impl) => isRegisteredTool(impl)),
    ),
  ];
  if (tools.length > 0) {
    out = setPath(out, "allowedTools", tools);
  }

  let matchThreshold: number | undefined;
  let rerank: boolean | undefined;

  for (const node of def.nodes) {
    const cfg = (node.config ?? {}) as Record<string, unknown>;
    if (typeof cfg.matchThreshold === "number") {
      matchThreshold = cfg.matchThreshold;
      out = setPath(out, "matchThreshold", cfg.matchThreshold);
    }
    if (Array.isArray(cfg.hardFilters)) {
      out = setPath(out, "hardFilters", cfg.hardFilters);
    }
    if (typeof cfg.rerank === "boolean") {
      rerank = cfg.rerank;
      out = setPath(out, "rerank", cfg.rerank);
    }
  }

  let prompt = stripWorkflowSectionFromPrompt(
    String(getPath(out, "prompt") ?? ""),
  );
  if (matchThreshold !== undefined) {
    prompt = syncThresholdInPrompt(prompt, matchThreshold);
  }
  if (rerank !== undefined) {
    prompt = syncRerankInPrompt(prompt, rerank);
  }
  out = setPath(out, "prompt", prompt);

  return out;
}
