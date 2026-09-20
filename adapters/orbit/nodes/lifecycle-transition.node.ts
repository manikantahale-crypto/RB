/**
 * orbit.lifecycle.transition — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/orbit.ts
 * (orbitLifecycleTransition). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * A person on the bench moves between states — AVAILABLE, BENCH, NOTICE, PLACED, HOLD, PRIORITIZE, OLD, IGNORE. ORBIT enforces which moves are allowed; this node asks for one and reports where the person ended up. Lent to other modules: ASTRA and SYNTRA both move people.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** orbit.ts:144-165 */
const Input = z
  .object({
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    person_id: z.string().optional(),
    to_state: z.string().optional(),
    toState: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((v) => Boolean(v.candidate_id ?? v.candidateId ?? v.person_id), { message: "needs candidate_id" })
  .refine((v) => Boolean((v.to_state ?? v.toState ?? "").trim()), { message: "needs to_state" });

const Output = z.object({
  candidateId: z.string(),
  fromState: z.string().nullable(),
  toState: z.string(),
  /** placed → the placement path; active → everything else. */
  branch_key: z.enum(["placed", "active"]),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const lifecycleTransition = defineNode({
  key: "orbit.lifecycle.transition",
  version: "1.0.0",
  module: "orbit",
  shareable: true,

  title: "Move a person to a bench state",
  description:
    "Asks ORBIT to move a person to a lifecycle state, which ORBIT allows or refuses by its own rules, and announces the transition.",
  tags: ["orbit", "lifecycle", "bench"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.lifecycle.transitioned"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["candidate_id", "candidateId", "person_id"], ["to_state", "toState"]] },

  execution: {
    /** One ORBIT call, no LLM. UNVERIFIED — not yet timed here. */
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
          name: "a person on the bench is placed",
          input: { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", to_state: "PLACED", note: "offer accepted" },
          config: {},
          expectedOutput: { candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f", fromState: "BENCH", toState: "PLACED", branch_key: "placed" },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "orbit.lifecycle.transition: declaration only — the live implementation is packages/orchestrator/src/nodes/orbit.ts",
    );
    throw new Error("orbit.lifecycle.transition is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
