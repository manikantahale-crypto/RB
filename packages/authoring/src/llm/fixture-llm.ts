import type { LLMClient } from "./types.js";
import type { LlmGraphProposal } from "../llm-graph-proposal-schema.js";

/**
 * Deterministic local LLM — parses threshold / rerank from admin English and
 * returns valid structured graph JSON. Used when LLM_PROVIDER=noop.
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

function defaultWorkflowProposal(): LlmGraphProposal {
  return {
    nodes: [
      {
        id: "jd",
        toolKey: "syntra.jd.process",
        description: "Process job description",
      },
      {
        id: "resume",
        toolKey: "syntra.resume.process",
        description: "Process resume profile",
      },
      {
        id: "match",
        toolKey: "syntra.match.process",
        description: "Score job against resume match",
      },
    ],
    edges: [
      { id: "e0", source: "__start__", target: "jd", label: null },
      { id: "e1", source: "jd", target: "resume", label: null },
      { id: "e2", source: "resume", target: "match", label: null },
      { id: "e3", source: "match", target: "__end__", label: null },
    ],
    unsupported: [],
  };
}

function duplicateReviewProposal(): LlmGraphProposal {
  return {
    nodes: [
      {
        id: "gate",
        toolKey: "human.gate",
        description: "Human duplicate review gate",
      },
    ],
    edges: [
      { id: "e0", source: "__start__", target: "gate", label: null },
      { id: "e1", source: "gate", target: "__end__", label: "approved" },
      { id: "e2", source: "gate", target: "__end__", label: "rejected" },
    ],
    unsupported: [],
  };
}

function intakeDuplicateMergeProposal(): LlmGraphProposal {
  return {
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
  };
}

function resumeOnlyProposal(): LlmGraphProposal {
  return {
    nodes: [
      {
        id: "resume",
        toolKey: "syntra.resume.process",
        description: "Process resume only",
      },
    ],
    edges: [
      { id: "e0", source: "__start__", target: "resume", label: null },
      { id: "e1", source: "resume", target: "__end__", label: null },
    ],
    unsupported: [],
  };
}

function pickProposal(request: string): LlmGraphProposal {
  if (
    /duplicate|merge the candidates|check for duplicates|human review/i.test(
      request,
    )
  ) {
    return intakeDuplicateMergeProposal();
  }
  if (/duplicate\s+review|human\s+review/i.test(request)) {
    return duplicateReviewProposal();
  }
  if (
    /resume\s+only|process\s+resume|intake/i.test(request) &&
    !/match|job\s+description|jd/i.test(request)
  ) {
    return resumeOnlyProposal();
  }
  return defaultWorkflowProposal();
}

export function createFixtureLlm(_defaultGraphKey = "syntra.authored"): LLMClient {
  return {
    async complete(req) {
      const request = req.prompt?.trim() ?? "";
      const proposal = pickProposal(request);
      return {
        text: JSON.stringify(proposal),
        model: "fixture-local",
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    },
  };
}

/** Test double: varies cosmetic fields to simulate LLM non-determinism. */
export function createVariabilityFixtureLlm(): LLMClient {
  const suffixes = [
    " (primary path)",
    " — standard flow",
    " for intake",
    " step",
    " in workflow",
  ];
  let calls = 0;

  return {
    async complete(req) {
      const idx = calls++;
      const base = pickProposal(req.prompt?.trim() ?? "");
      const suffix = suffixes[idx % suffixes.length] ?? "";

      const nodes = [...base.nodes]
        .map((n) => ({
          ...n,
          description: n.description + suffix,
        }))
        .sort((a, b) =>
          idx % 2 === 0 ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id),
        );

      const edges = [...base.edges];
      if (idx % 4 === 2) {
        edges.push({
          id: "bad-edge",
          source: "detect",
          target: "merge",
          label: "invalid_label",
        });
      }
      if (idx % 5 === 3) {
        nodes.push({
          id: "phantom",
          toolKey: "syntra.fake.tool" as (typeof base.nodes)[number]["toolKey"],
          description: "should be stripped",
        });
      }

      return {
        text: JSON.stringify({ ...base, nodes, edges }),
        model: `fixture-variability-${idx}`,
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    },
  };
}
