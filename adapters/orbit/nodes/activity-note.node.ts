/**
 * orbit.activity.note — a DECLARATION, not an implementation.
 *
 * The engine runs this node: packages/orchestrator/src/nodes/orbit.ts
 * (orbitActivityNote). This file is what `node_registry` and the editor project
 * — input, output, settings, what it publishes — written from that code on
 * 2026-09-20, line by line. Like `orch.branch.decision`, it stays out of
 * `nodeContracts` until the implementation moves in here at stage 5; until
 * then a change to the engine file is a change to this one.
 *
 * A line on a person's timeline — what happened, said by whom. Every module appends to the same feed (core.activities, decision D2); this is ORBIT's node for doing it from a workflow.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";


/** orbit.ts:357-390 */
const Input = z
  .object({
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    summary: z.string().optional(),
    note: z.string().optional(),
    activity_type: z.string().optional(),
    activityType: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Boolean(v.candidate_id ?? v.candidateId), { message: "needs candidate_id" })
  .refine((v) => Boolean((v.summary ?? v.note ?? "").trim()), { message: "needs a summary or note" });

const Output = z.object({
  candidateId: z.string(),
  activityType: z.string(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const activityNote = defineNode({
  key: "orbit.activity.note",
  version: "1.0.0",
  module: "orbit",
  shareable: true,

  title: "Note something on a person's timeline",
  description:
    "Writes an activity line — a note, a call, a status — on a person's timeline and announces it.",
  tags: ["orbit", "activity", "timeline"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["orbit.activity.noted"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["candidate_id", "candidateId"], ["summary", "note"]] },

  execution: {
    /** One ORBIT call. UNVERIFIED — not yet timed here. */
    timeoutMs: 15_000,
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
          name: "a recruiter's note",
          input: { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", summary: "Spoke on the phone; available from October.", activity_type: "NOTE" },
          config: {},
          expectedOutput: { candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f", activityType: "NOTE" },
        },
      ],

  /**
   * Never called. The engine's own function runs this node; this
   * declaration must not be in `nodeContracts`, and throwing is how that
   * stays true.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "orbit.activity.note: declaration only — the live implementation is packages/orchestrator/src/nodes/orbit.ts",
    );
    throw new Error("orbit.activity.note is a declaration, not an implementation. It must not be in nodeContracts.");
  },
});
