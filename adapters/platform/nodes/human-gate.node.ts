/**
 * human.gate — the worked reference for the node contract.
 *
 * Copy this file's SHAPE, not its answers. Every judgement below is argued in
 * a comment because those four judgements are the whole job: sideEffect,
 * idempotency, persistence, and which config fields an admin may touch.
 *
 * The `run` body here is a placeholder — the live implementation still lives
 * in the engine at packages/engine/src/nodes/human-gate.ts and is wired to
 * this contract once the runtime bridge lands. This file declares shapes only.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";

/* ─────────────────────────────── shapes ──────────────────────────────── */

/** Runtime dataflow: what the graph hands this node on each run. */
const Input = z.object({
  /** Why a human is being asked. Shown on the approval card. */
  reason: z.string().min(1),
  /** The thing being approved, so the reviewer has something to look at. */
  subjectId: z.string().uuid().optional(),
});

/** What the node returns once a human has answered. */
const Output = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
  decidedBy: z.string().optional(),
});

/**
 * Design-time values, frozen into the graph version.
 *
 * `reason` is adminExposed: a customer may want the card to say "Compliance
 * review" instead of "Manual review" — wording, not structure, so it is safe
 * to change without a PR. `timeoutHours` is NOT exposed: how long a run may
 * sit parked is a platform decision with queue-depth consequences.
 */
const Config = z.object({
  reason: z
    .string()
    .min(1)
    .default("human_review")
    .meta({ adminExposed: true, label: "Reason shown to the reviewer" }),
  timeoutHours: z.int().positive().default(72),
});

/* ────────────────────────────── contract ─────────────────────────────── */

export const humanGate = defineNode({
  key: "human.gate",
  version: "1.0.0",
  module: "platform",
  /** Every module's graphs need to pause for a person. */
  shareable: true,

  title: "Human approval gate",
  description:
    "Pauses the workflow and waits for a named person to approve or reject before anything downstream runs.",
  tags: ["control", "approval", "human-in-the-loop"],

  input: Input,
  output: Output,
  config: Config,

  /**
   * `control`, not `internal_write`. This node changes no business data — it
   * parks the run and emits an approval-requested event. Orchestration, not
   * meaning. If it ever starts writing a decision row itself, this becomes
   * `internal_write` and the idempotency answer below stops being legal.
   */
  sideEffect: "control",

  /**
   * `pure` is legal here only because `control` writes nothing. Re-entering
   * the gate re-parks the run; it does not double-approve, because approval
   * arrives as a separate resume event carrying its own identity.
   */
  idempotency: { strategy: "pure" },

  execution: {
    /** Parking is fast; the WAIT is not execution time. */
    timeoutMs: 30_000,
    /**
     * limit 0 — never retry a human. A retry would emit a second approval
     * card for the same decision and ask the same person twice.
     */
    retry: { limit: 0, backoff: "none", baseMs: 1 },
    /**
     * Nothing this node can throw is the user's fault or a passing blip: if
     * parking failed, the checkpointer or the outbox is broken.
     */
    classifyError: () => "permanent_system",
    locks: [],
  },

  /** No LLM, no HTTP — CI runs this node for real. */
  dependencies: [],

  /**
   * Nothing here is PII: a reason string and an id. Both are worth seeing in
   * run detail when someone asks why a run sat waiting for two days.
   *
   * Contrast syntra.resume.process, where the input carries resume
   * text and this block MUST redact it.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * Realistic, not `{}`. Both arms of a boolean gate are worth pinning —
   * a rejection that silently behaves like an approval is the failure that
   * matters.
   */
  fixtures: [
    {
      name: "approved by a reviewer",
      input: {
        reason: "duplicate requires manual review",
        subjectId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      },
      config: { reason: "duplicate requires manual review", timeoutHours: 72 },
      expectedOutput: {
        approved: true,
        note: "confirmed distinct requirement",
        decidedBy: "recruiter@example.com",
      },
    },
    {
      name: "rejected by a reviewer",
      input: {
        reason: "duplicate requires manual review",
        subjectId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      },
      config: { reason: "duplicate requires manual review", timeoutHours: 72 },
      expectedOutput: {
        approved: false,
        note: "same requirement as REQ-8812",
        decidedBy: "recruiter@example.com",
      },
    },
  ],

  /**
   * Declares no llm/external-api dependency, so no stub is required.
   *
   * The runtime bridge replaces this body with the live implementation — emit
   * APPROVAL_REQUESTED, then `interrupt()` to park the run. The contract does
   * not change when it does.
   */
  run: async (ctx: NodeRunCtx, input, config) => {
    ctx.logger.info("human.gate: parking run", {
      reason: input.reason || config.reason,
    });
    throw new Error("human.gate: not wired to the runtime yet");
  },
});
