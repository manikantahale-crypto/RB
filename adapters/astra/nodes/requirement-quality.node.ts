/**
 * astra.requirement.quality — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/astra.ts
 * (astraRequirementQuality). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * A cheap first look before the full enrichment: is this a real requirement, and how sure are we? The two numbers it produces are what orch.branch.decision branches on.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** astra.ts:299-311 */
const Input = z.object({
  jobId: z.string().optional(),
  requirement_id: z.string().optional(),
  title: z.string().optional(),
  raw_text: z.string().optional(),
  rawText: z.string().optional(),
  required_skills: z.array(z.string()).optional(),
  requiredSkills: z.array(z.string()).optional(),
  location: z.string().optional(),
});

const Output = z.object({
  is_actionable: z.boolean(),
  confidence_score: z.number().min(0).max(1),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const requirementQuality = defineNode({
  key: "astra.requirement.quality",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Judge a requirement's quality",
  description:
    "Asks SYNTRA for a quick quality read on a requirement — actionable or not, and a confidence — and announces the score for the branch that follows.",
  tags: ["astra", "quality", "scoring"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["astra.requirement.scored"],
  sideEffect: "read",
  idempotency: { strategy: "pure" },

  execution: {
    /** One SYNTRA call, no LLM on that side (astra.ts calls it the cheap score). UNVERIFIED. */
    timeoutMs: 30_000,
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
          name: "a requirement with skills and a location reads as actionable",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", title: "Java Developer", required_skills: ["java", "spring"], location: "Austin, TX" },
          config: {},
          expectedOutput: { is_actionable: true, confidence_score: 0.75 },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "astra.requirement.quality: declaration only — the live implementation is packages/orchestrator/src/nodes/astra.ts",
    );
    throw new Error("astra.requirement.quality is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
