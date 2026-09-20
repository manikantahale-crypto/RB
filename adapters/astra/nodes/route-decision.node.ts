/**
 * astra.route.decision — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/astra.ts
 * (astraRouteDecision). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * The gate at the end of ASTRA's intake: an actionable requirement is handed to SYNTRA (syntra.jd.normalized), anything else is announced rejected. Which two events it publishes is configuration — the defaults are the platform's chain.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** astra.ts:420-460 */
const Input = z
  .object({
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    is_actionable: z.boolean().optional(),
    isActionable: z.boolean().optional(),
    confidence_score: z.number().optional(),
    confidenceScore: z.number().optional(),
    parser_version: z.string().optional(),
  })
  .refine((v) => Boolean(v.jobId ?? v.requirement_id), { message: "needs jobId" });

const Output = z.object({
  /** pass → the actionable event; reject → the rejected event. */
  branch_key: z.enum(["pass", "reject"]),
  jobId: z.string(),
});

const Config = z.object({
  /** Below this confidence a requirement is rejected even when actionable. */
  minConfidence: z.number().min(0).max(1).default(0).meta({ adminExposed: true, label: "Minimum confidence" }),
  /** The event published when the requirement goes forward. */
  onActionable: z.string().default("syntra.jd.normalized"),
  /** The event published when it does not. */
  onRejected: z.string().default("astra.requirement.rejected"),
  agentName: z.string().optional(),
});

export const routeDecision = defineNode({
  key: "astra.route.decision",
  version: "1.0.0",
  module: "astra",
  shareable: false,

  title: "Send a requirement on, or reject it",
  description:
    "Reads the quality verdict on a requirement and either hands it to SYNTRA as a normalized JD or announces it rejected, with the reason.",
  tags: ["astra", "control", "routing"],

  input: Input,
  output: Output,
  config: Config,

  emits: [{ fromConfig: "onActionable" }, { fromConfig: "onRejected" }],
  sideEffect: "control",
  idempotency: { strategy: "pure" },

  execution: {
    /** Arithmetic on the payload; two possible emits. */
    timeoutMs: 5_000,
    retry: { limit: 0, backoff: "none", baseMs: 1 },
    classifyError: () => "permanent_input",
    locks: [],
  },

  dependencies: [],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "an actionable requirement goes forward",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", is_actionable: true, confidence_score: 0.82 },
          config: { minConfidence: 0.5, onActionable: "syntra.jd.normalized", onRejected: "astra.requirement.rejected" },
          expectedOutput: { branch_key: "pass", jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
        },
        {
          name: "actionable but not confident enough is rejected",
          input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", is_actionable: true, confidence_score: 0.3 },
          config: { minConfidence: 0.5, onActionable: "syntra.jd.normalized", onRejected: "astra.requirement.rejected" },
          expectedOutput: { branch_key: "reject", jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "astra.route.decision: declaration only — the live implementation is packages/orchestrator/src/nodes/astra.ts",
    );
    throw new Error("astra.route.decision is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
