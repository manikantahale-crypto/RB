/**
 * syntra.duplicate.detect
 *
 * The question this node had to answer: "Emits conditionally — the `emits` block must say so honestly."
 *
 * The node contract has no `emits` block; that belongs to the graph definition.
 * What a node CAN do is make the conditionality visible in its own output, so
 * the graph author writing that block has something truthful to read. Hence
 * `reviewRequired` and `duplicateOf` below: the two fixtures pin both arms, and
 * the graph's `emits.needs_human` is only reachable when the first is true.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

const Input = z
  .object({
    candidateId: z.string().min(1).optional(),
    candidate_id: z.string().min(1).optional(),
    candidate_profile_id: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.candidateId ?? v.candidate_id), {
    message: "needs candidateId or candidate_id",
  });

/**
 * `reviewRequired` is the honest half of this contract. A detection that finds
 * nothing is a SUCCESS, not a failure — and the output says so plainly rather
 * than leaving the caller to infer it from a missing event.
 */
const Output = z.object({
  candidateId: z.string(),
  reviewRequired: z.boolean(),
  duplicateOf: z.string().nullable(),
  duplicateReviewId: z.string().nullable(),
  status: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  /**
   * How similar two candidates must look before a person is asked. Exposed
   * because tolerance for false positives is genuinely per-customer: an agency
   * with a small bench wants fewer interruptions than one with a large bench.
   */
  similarityThreshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .meta({ adminExposed: true, label: "Duplicate similarity threshold" }),
});

export const duplicateDetect = defineNode({
  key: "syntra.duplicate.detect",
  version: "1.0.0",
  module: "syntra",
  shareable: true,

  title: "Check a candidate for duplicates",
  description:
    "Once a candidate profile is ready, asks SYNTRA whether it looks like someone already on the bench, and raises a review only when it does.",
  tags: ["syntra", "duplicate", "data-quality"],

  input: Input,
  output: Output,
  config: Config,

  /**
   * `internal_write`, not `read`, and this one is easy to get wrong. The call
   * reads like a question, but SYNTRA records a duplicate-review row when it
   * finds a match — so running it twice can raise two reviews for one person.
   */
  sideEffect: "internal_write",

  /**
   * Keyed on the candidate being checked. One open duplicate review per
   * candidate: a retry re-checks the same person rather than queueing a second
   * review for a human to work through.
   */
  idempotency: { strategy: "natural_key", keyPaths: ["candidateId"] },

  execution: {
    timeoutMs: 60_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifySyntraError,
    locks: [],
  },

  dependencies: ["http"],

  /**
   * Two candidate ids and similarity signals. No names, no contact details,
   * no resume text — and the signals are exactly what the reviewing human
   * needs in order to judge, so hiding them would defeat the review.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * Both arms pinned, because a detector that silently always says "no" would
   * pass a single-fixture suite forever.
   *
   * HONEST STATUS: hand-written, not captured. Re-capture before the fixture runner lands.
   */
  fixtures: [
    {
      name: "finds a probable duplicate and asks for review",
      input: { candidateId: "c7e8f9a0-0000-4000-8000-000000000202" },
      config: { similarityThreshold: 0.9 },
      expectedOutput: {
        candidateId: "c7e8f9a0-0000-4000-8000-000000000202",
        reviewRequired: true,
        duplicateOf: "c7e8f9a0-0000-4000-8000-000000000999",
        duplicateReviewId: "e1f2a3b4-0000-4000-8000-000000000404",
        status: "duplicate_suspected",
        stubbed: false,
      },
    },
    {
      name: "finds nothing, which is the common and successful case",
      input: { candidate_id: "c7e8f9a0-0000-4000-8000-000000000202" },
      config: {},
      expectedOutput: {
        candidateId: "c7e8f9a0-0000-4000-8000-000000000202",
        reviewRequired: false,
        duplicateOf: null,
        duplicateReviewId: null,
        status: "clear",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const candidateId = input.candidateId ?? input.candidate_id!;

    ctx.logger.info("calling Syntra duplicate detect", {
      candidateId,
      orgId: ctx.orgId,
    });
    const r = await postSyntra(
      `/internal/candidates/${candidateId}/duplicates/detect`,
      { candidateId, candidate_profile_id: input.candidate_profile_id },
    );

    const other = (r.candidate_b ?? r.duplicateCandidateId ?? null) as string | null;
    const duplicateReviewId = other
      ? String(r.duplicate_review_id ?? crypto.randomUUID())
      : null;

    // Emitted ONLY when there is something for a person to decide. A run that
    // finds nothing ends here, and that is a completed run, not a dead end.
    if (other) {
      ctx.emit({
        event_type: "syntra.duplicate.review_required",
        payload: {
          duplicate_review_id: duplicateReviewId,
          candidate_a: candidateId,
          candidate_b: other,
          approval_id: r.approval_id ?? null,
          signals: r.signals ?? {},
          status: r.status,
          syntra: r,
        },
      });
    }

    return {
      candidateId,
      reviewRequired: Boolean(other),
      duplicateOf: other,
      duplicateReviewId,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
