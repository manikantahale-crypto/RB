/**
 * orbit.route.decision — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/orbit.ts
 * (orbitRouteDecision). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * After a lifecycle move, which way does the workflow go? placed → the placement path; hold → announce the hold and stop; anything else → the active path. Reads the state the transition produced.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** orbit.ts:416-441 — reads to_state, or the branch_key an earlier step set. */
const Input = z.object({
  to_state: z.string().optional(),
  toState: z.string().optional(),
  branch_key: z.string().optional(),
  candidate_id: z.string().optional(),
  candidateId: z.string().optional(),
  note: z.string().optional(),
});

const Output = z.object({
  branch_key: z.enum(["placed", "hold", "active"]),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const orbitRouteDecision = defineNode({
  key: "orbit.route.decision",
  version: "1.0.0",
  module: "orbit",
  shareable: false,

  title: "Route after a bench move",
  description:
    "Sends the workflow down the placement path, the hold path or the active path according to the state a person just moved to; a hold is announced.",
  tags: ["orbit", "control", "routing"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.bench.hold"],
  sideEffect: "control",
  idempotency: { strategy: "pure" },

  execution: {
    /** A comparison on the payload. */
    timeoutMs: 5_000,
    retry: { limit: 0, backoff: "none", baseMs: 1 },
    classifyError: () => "permanent_input",
    locks: [],
  },

  dependencies: [],

  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
        {
          name: "PLACED goes down the placement path",
          input: { to_state: "PLACED" },
          config: {},
          expectedOutput: { branch_key: "placed" },
        },
        {
          name: "HOLD is announced and stops",
          input: { to_state: "HOLD", candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", note: "visa pending" },
          config: {},
          expectedOutput: { branch_key: "hold" },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "orbit.route.decision: declaration only — the live implementation is packages/orchestrator/src/nodes/orbit.ts",
    );
    throw new Error("orbit.route.decision is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
