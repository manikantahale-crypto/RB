/**
 * orbit.revenue.arrange — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/orbit.ts
 * (orbitRevenueArrange). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * How the company earns on a placement — a markup, a fee, a formula — attached to the placement row. Money is described, not moved; the arrangement is a record.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** orbit.ts:292-330 */
const Input = z
  .object({
    placement_id: z.string().optional(),
    placementId: z.string().optional(),
    arrangement_type: z.string().optional(),
    arrangementType: z.string().optional(),
    value: z.number().optional(),
    notes: z.string().nullable().optional(),
    custom_formula: z.string().nullable().optional(),
    customFormula: z.string().nullable().optional(),
  })
  .refine((v) => Boolean(v.placement_id ?? v.placementId), { message: "needs placement_id" });

const Output = z.object({
  placementId: z.string(),
  arrangementType: z.string(),
  value: z.number(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const revenueArrange = defineNode({
  key: "orbit.revenue.arrange",
  version: "1.0.0",
  module: "orbit",
  shareable: false,

  title: "Record how a placement earns",
  description:
    "Attaches a revenue arrangement — markup, fee or formula — to a placement and announces it.",
  tags: ["orbit", "revenue", "placement"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.revenue.arranged"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["placement_id", "placementId"], ["arrangement_type", "arrangementType"]] },

  execution: {
    /** One ORBIT call. UNVERIFIED — not yet timed here. */
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
          name: "a markup on a placement",
          input: { placement_id: "5d9e0b6a-0d1c-4f4e-9a3b-2c6d7e8f9a01", arrangement_type: "MARKUP", value: 25 },
          config: {},
          expectedOutput: { placementId: "5d9e0b6a-0d1c-4f4e-9a3b-2c6d7e8f9a01", arrangementType: "MARKUP", value: 25 },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "orbit.revenue.arrange: declaration only — the live implementation is packages/orchestrator/src/nodes/orbit.ts",
    );
    throw new Error("orbit.revenue.arrange is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
