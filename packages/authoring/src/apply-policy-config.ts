import type { GraphDefinition } from "./graph-definition.js";
import { parseMatchConfigFromRequest } from "./llm/fixture-llm.js";
import { HARD_FILTER_KEYS, type HardFilterKey } from "./validate-llm-graph.js";

/** Deterministic policy-text → node.config stamping (not LLM-driven). */
export function applyDeterministicPolicyConfig(
  def: GraphDefinition,
  policyText: string,
): GraphDefinition {
  const matchConfig = parseMatchConfigFromRequest(policyText);
  const hardFilters = hardFiltersFromPolicyText(policyText);
  const hasMatchConfig =
    Object.keys(matchConfig).length > 0 || hardFilters.length > 0;
  if (!hasMatchConfig) return def;

  const nodes = def.nodes.map((node) => {
    if (node.impl !== "syntra.match.process") return node;
    const config = { ...(node.config ?? {}) };
    if (matchConfig.matchThreshold !== undefined) {
      config.matchThreshold = matchConfig.matchThreshold;
    }
    if (matchConfig.rerank !== undefined) {
      config.rerank = matchConfig.rerank;
    }
    if (hardFilters.length > 0) {
      config.hardFilters = hardFilters;
    }
    return { ...node, config };
  });

  return { ...def, nodes };
}

function hardFiltersFromPolicyText(text: string): HardFilterKey[] {
  const found = new Set<HardFilterKey>();
  const lower = text.toLowerCase();
  for (const key of HARD_FILTER_KEYS) {
    if (lower.includes(key)) found.add(key);
  }
  if (/\bvisa\b/i.test(text) || /need(s)? a visa/i.test(text)) {
    found.add("visa");
  }
  return [...found].sort();
}
