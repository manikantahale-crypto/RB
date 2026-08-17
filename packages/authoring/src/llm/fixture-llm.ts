import type { LLMClient } from "./types.js";

/**
 * Deterministic local LLM — parses threshold / rerank from admin English and
 * returns valid graph JSON. Used when LLM_PROVIDER=noop so dev + smoke tests
 * work without a network API key.
 *
 * Real providers (openai, gemini, …) use {@link createLlmClient} HTTP clients.
 */
export function parseMatchConfigFromRequest(text: string): {
  matchThreshold?: number;
  rerank?: boolean;
} {
  const out: { matchThreshold?: number; rerank?: boolean } = {};
  const threshold =
    text.match(/threshold(?:\s+of)?\s*(\d{1,3})/i) ??
    text.match(/(?:cutoff|score)(?:\s+of)?\s*(\d{1,3})/i) ??
    text.match(/(\d{1,3})\s*%?\s*threshold/i);
  if (threshold) {
    const n = Number(threshold[1]);
    if (!Number.isNaN(n) && n >= 0 && n <= 100) {
      out.matchThreshold = n;
    }
  }
  if (/rerank(?:ing)?\s+off|no\s+rerank|turn\s+off\s+rerank/i.test(text)) {
    out.rerank = false;
  } else if (/rerank(?:ing)?\s+on|enable\s+rerank/i.test(text)) {
    out.rerank = true;
  }
  return out;
}

function defaultWorkflowGraph(
  graphKey: string,
  matchConfig: Record<string, unknown>,
): Record<string, unknown> {
  const matchNode: Record<string, unknown> = {
    id: "match",
    impl: "syntra.match.process",
  };
  if (Object.keys(matchConfig).length > 0) {
    matchNode.config = matchConfig;
  }
  return {
    graphKey,
    nodes: [
      { id: "jd", impl: "syntra.jd.process" },
      { id: "resume", impl: "syntra.resume.process" },
      matchNode,
    ],
    edges: [
      ["__start__", "jd"],
      ["jd", "resume"],
      ["resume", "match"],
      ["match", "__end__"],
    ],
    unsupported: [],
  };
}

function duplicateReviewGraph(graphKey: string): Record<string, unknown> {
  return {
    graphKey,
    nodes: [
      {
        id: "gate",
        impl: "human.gate",
        config: { reason: "duplicate_review" },
      },
    ],
    edges: [
      ["__start__", "gate"],
      ["gate", "__end__"],
    ],
    unsupported: [],
  };
}

function resumeOnlyGraph(graphKey: string): Record<string, unknown> {
  return {
    graphKey,
    nodes: [{ id: "resume", impl: "syntra.resume.process" }],
    edges: [
      ["__start__", "resume"],
      ["resume", "__end__"],
    ],
    unsupported: [],
  };
}

export function createFixtureLlm(defaultGraphKey = "syntra.authored"): LLMClient {
  return {
    async complete(req) {
      const request = req.prompt?.trim() ?? "";
      const graphKey =
        /graphKey\s*[:=]\s*([\w.]+)/i.exec(request)?.[1]?.trim() ??
        defaultGraphKey;

      let proposal: Record<string, unknown>;
      if (
        /duplicate\s+review|duplicate\s+detection|human\s+review/i.test(request)
      ) {
        proposal = duplicateReviewGraph(graphKey);
      } else if (
        /resume\s+only|process\s+resume|intake/i.test(request) &&
        !/match|job\s+description|jd/i.test(request)
      ) {
        proposal = resumeOnlyGraph(graphKey);
      } else {
        const matchConfig = parseMatchConfigFromRequest(request);
        proposal = defaultWorkflowGraph(graphKey, matchConfig);
      }

      return {
        text: JSON.stringify(proposal),
        model: "fixture-local",
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    },
  };
}
