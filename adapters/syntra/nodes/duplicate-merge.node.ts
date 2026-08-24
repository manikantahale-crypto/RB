/**
 * syntra.duplicate.merge
 *
 * The question this node had to answer: "A merge is destructive. Retrying twice must not merge twice."
 *
 * This is the most dangerous node in the set. Merging two candidate records
 * cannot be undone by rolling back a workflow version: the rows are already
 * combined, and the second person's history now hangs off the first.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

const Input = z
  .object({
    approval_id: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
    decision: z.enum(["APPROVED", "MODIFIED", "REJECTED", "EXPIRED"]).optional(),
    candidate_a: z.string().min(1).optional(),
    candidate_b: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.approval_id ?? v.approvalId), {
    message: "needs approval_id — a merge without a recorded decision is not permitted",
  });

const Output = z.object({
  approvalId: z.string(),
  /** False when the human said no, or the approval expired. */
  merged: z.boolean(),
  keptCandidateId: z.string().nullable(),
  status: z.string(),
  stubbed: z.boolean(),
});

/** Empty on purpose — see the note below. */
const Config = z.object({});

export const duplicateMerge = defineNode({
  key: "syntra.duplicate.merge",
  version: "1.0.0",
  module: "syntra",
  shareable: false, // only SYNTRA owns candidate records; nobody else merges them

  title: "Merge duplicate candidates",
  description:
    "After a person decides two candidate records are the same, tells SYNTRA to combine them into one.",
  tags: ["syntra", "duplicate", "destructive"],

  input: Input,
  output: Output,

  /**
   * NO CONFIGURATION, AND THAT IS THE DESIGN.
   *
   * Every knob here would be a way to change what gets destroyed — which
   * record survives, whether to merge without a decision, how aggressively to
   * combine fields. There is no such thing as an admin-tunable merge. The only
   * input that may authorise this is a recorded human decision.
   */
  config: Config,

  /**
   * `internal_write` — the records are ours and nothing leaves the building.
   *
   * Worth saying plainly: `internal_write` is not the same as "low risk". The
   * side-effect class describes REACH, not damage. This is the most
   * destructive node we have and it is correctly classed as internal.
   */
  sideEffect: "internal_write",

  /**
   * THE ARGUMENT — "retrying twice must not merge twice".
   *
   * `idempotency_key`, not `natural_key`. The candidate pair would be the
   * obvious natural key, but it is the wrong one: after the first merge one of
   * those two candidates no longer exists as a separate record, so a retry
   * keyed on the pair has nothing to match against and would look like a fresh
   * request.
   *
   * The approval id is stable, exists before the merge, and survives it. One
   * approval authorises exactly one merge, forever. A retry carrying the same
   * approval must be recognised server-side and answered with the result of
   * the first merge, not a second one.
   *
   * The lock closes the narrower window: two workers processing the same
   * approval concurrently, where neither has committed yet for the other to
   * see.
   *
   * REVIEWER: this asserts that SYNTRA dedupes on approval id. That assertion
   * is the single thing standing between a retry and a destroyed record. It
   * must be confirmed, not assumed — and if it is not true today, this node
   * should not run until it is.
   */
  idempotency: { strategy: "idempotency_key", keyPath: "approval_id" },

  execution: {
    timeoutMs: 60_000,
    /**
     * ONE retry, and only because a timeout after a successful merge would
     * otherwise strand the workflow. The idempotency key is what makes even
     * this one safe; without it the right number here is zero.
     */
    retry: { limit: 1, backoff: "fixed", baseMs: 3_000 },
    classifyError: classifySyntraError,
    /** Serialise per approval — two workers must never merge the same pair. */
    locks: ["syntra.duplicate-merge"],
  },

  dependencies: ["http"],

  /**
   * Kept in full, on purpose. This is a destructive, human-authorised action,
   * and the audit trail is the only record of who decided what and which
   * record survived. Redacting it would remove exactly the evidence someone
   * will need when a candidate asks why their history changed.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /** HONEST STATUS: hand-written, not captured. Re-capture before the fixture runner lands. */
  fixtures: [
    {
      name: "merges after a human approved",
      input: {
        approval_id: "a1b2c3d4-0000-4000-8000-000000000505",
        decision: "APPROVED",
        candidate_a: "c7e8f9a0-0000-4000-8000-000000000202",
        candidate_b: "c7e8f9a0-0000-4000-8000-000000000999",
      },
      config: {},
      expectedOutput: {
        approvalId: "a1b2c3d4-0000-4000-8000-000000000505",
        merged: true,
        keptCandidateId: "c7e8f9a0-0000-4000-8000-000000000202",
        status: "merged",
        stubbed: false,
      },
    },
    {
      name: "does nothing when the human said they are different people",
      input: {
        approvalId: "a1b2c3d4-0000-4000-8000-000000000506",
        decision: "REJECTED",
        candidate_a: "c7e8f9a0-0000-4000-8000-000000000202",
        candidate_b: "c7e8f9a0-0000-4000-8000-000000000999",
      },
      config: {},
      expectedOutput: {
        approvalId: "a1b2c3d4-0000-4000-8000-000000000506",
        merged: false,
        keptCandidateId: null,
        status: "not_merged",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const approvalId = input.approval_id ?? input.approvalId!;

    ctx.logger.info("calling Syntra duplicate merge", { approvalId, orgId: ctx.orgId });
    const r = await postSyntra(`/internal/approvals/${approvalId}/duplicate-merge`, {
      approval_id: approvalId,
      decision: input.decision,
      candidate_a: input.candidate_a,
      candidate_b: input.candidate_b,
    });

    // SYNTRA decides whether the recorded decision authorises a merge. This
    // node does not re-interpret a human's answer.
    const merged = r.merged === true || r.status === "merged";

    return {
      approvalId,
      merged,
      keptCandidateId: (r.kept_candidate_id ?? r.candidate_a ?? null) as string | null,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
