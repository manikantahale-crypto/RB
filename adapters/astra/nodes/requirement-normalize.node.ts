/**
 * astra.requirement.normalize — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/astra.ts
 * (astraRequirementNormalize). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * The full enrichment: SYNTRA reads the requirement text with an LLM and fills title, company, location, experience, visa, employment type, skills and the summary. This is the call that, when it failed, used to be recorded as a success with no skills (ref/SYNTRA_Matching_Study.md §6).
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** astra.ts:346-372 — needs the requirement id; the text is read by SYNTRA. */
const Input = z
  .object({
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    requirementId: z.string().optional(),
    raw_text: z.string().optional(),
    rawText: z.string().optional(),
  })
  .refine((v) => Boolean(v.jobId ?? v.requirement_id ?? v.requirementId), {
    message: "needs jobId — there is nothing to normalize without one",
  });

const Output = z.object({
  jobId: z.string(),
  status: z.string(),
  is_actionable: z.boolean(),
  confidence_score: z.number().min(0).max(1),
});

const Config = z.object({
  /** Extra instruction for the extraction, appended to SYNTRA's prompt. Not exposed: it changes what the parse means. */
  prompt: z.string().optional(),
  agentName: z.string().optional(),
});

export const requirementNormalize = defineNode({
  key: "astra.requirement.normalize",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Enrich a requirement",
  description:
    "Asks SYNTRA's ASTRA to read the requirement in full — title, client, location, experience, visa, skills, summary — and announces it normalized with its quality read.",
  tags: ["astra", "enrichment", "llm"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["astra.requirement.normalized"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["jobId", "requirement_id", "requirementId"]] },

  execution: {
    /** One SYNTRA call that parses with an LLM through the provider chain. UNVERIFIED — not yet timed here. */
    timeoutMs: 90_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: (e) => {
      const m = String((e as Error)?.message ?? e);
      if (/\b(400|404|422)\b|permanent-input|empty|no jobId|not found/i.test(m)) return "permanent_input";
      return "transient";
    },
    locks: [],
  },

  dependencies: ["http"],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "a requirement is read in full",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
          config: {},
          expectedOutput: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", status: "normalized", is_actionable: true, confidence_score: 0.82 },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "astra.requirement.normalize: declaration only — the live implementation is packages/orchestrator/src/nodes/astra.ts",
    );
    throw new Error("astra.requirement.normalize is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
