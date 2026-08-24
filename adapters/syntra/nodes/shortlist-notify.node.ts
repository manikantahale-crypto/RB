/**
 * syntra.shortlist.notify
 *
 * The question this node had to answer: "Same question, and the answer here is probably external."
 * It is declared `external`, and that declaration costs something real —
 * see `sideEffect` for why paying it is the right call.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

const Input = z
  .object({
    jobId: z.string().min(1).optional(),
    requirement_id: z.string().min(1).optional(),
    match_job_id: z.string().min(1).optional(),
    result_count: z.number().int().min(0).optional(),
  })
  .refine((v) => Boolean(v.jobId ?? v.requirement_id), {
    message: "needs jobId or requirement_id",
  });

const Output = z.object({
  jobId: z.string(),
  matchJobId: z.string().nullable(),
  notified: z.boolean(),
  status: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  /**
   * Not adminExposed. Suppressing notifications for small shortlists sounds
   * like a preference, but it decides whether a person is told about a
   * candidate — that is workflow structure and it rides review.
   */
  minResultsToNotify: z.number().int().min(0).optional(),
});

export const shortlistNotify = defineNode({
  key: "syntra.shortlist.notify",
  version: "1.0.0",
  module: "syntra",
  shareable: true,

  title: "Tell someone the shortlist is ready",
  description:
    "Once matching finishes for a requirement, tells SYNTRA to notify the people waiting that a shortlist is ready to review.",
  tags: ["syntra", "shortlist", "notify"],

  input: Input,
  output: Output,
  config: Config,

  /**
   * THE ARGUMENT, AND THE DIFFERENCE FROM syntra.bench.alert.
   *
   * `bench.alert` asks a question and emits an internal fact. This node's whole
   * purpose is to reach a PERSON. The endpoint is `/shortlist/notify`, and a
   * notification that nobody receives is not a notification.
   *
   * Whether that arrives as an email, a push, or only a badge inside SYNTRA's
   * own UI, I could not confirm — SYNTRA was not running during conversion and
   * the code comment says only "(UI notify)".
   *
   * So this is declared on the CAUTIOUS side, deliberately. If it is external
   * and we declare internal, a duplicate run emails a client twice and nobody
   * had to justify it in writing. If it is internal and we declare external, we
   * pay: an allowlist entry with a written justification per graph, no
   * AI-generated insertion, and no TEST THIS NODE button in the editor.
   *
   * The first mistake reaches a customer. The second annoys an engineer. When
   * the evidence is genuinely unclear, take the one that annoys the engineer —
   * and relax it later on evidence, not on convenience.
   *
   * REVIEWER: confirm with the SYNTRA team what this endpoint actually sends.
   * If it never leaves their UI, downgrade to `internal_write` in a PR that
   * says so, and this comment is the record of why it started here.
   */
  sideEffect: "external",

  /**
   * Cannot be pure — `external` forbids it, and rightly. Keyed on the match
   * job rather than the requirement: one notification per completed shortlist,
   * so re-running matching later legitimately notifies again, while a retry of
   * THIS run does not.
   */
  idempotency: { strategy: "natural_key", keyPaths: ["match_job_id"] },

  execution: {
    timeoutMs: 30_000,
    /**
     * One cautious retry. Every retry of an external send is a chance to reach
     * someone twice, and the natural key is the only thing standing between a
     * blip and a duplicate message.
     */
    retry: { limit: 1, backoff: "fixed", baseMs: 5_000 },
    classifyError: classifySyntraError,
    locks: [],
  },

  dependencies: ["http"],

  /**
   * A requirement id and a count. No candidate names and no contact details —
   * which matters more here than elsewhere, because this is the node whose
   * audit trail someone will read after asking "who was told what?"
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /** HONEST STATUS: hand-written, not captured. Re-capture before the fixture runner lands. */
  fixtures: [
    {
      name: "notifies when a shortlist has results",
      input: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        match_job_id: "d5f6a7b8-0000-4000-8000-000000000303",
        result_count: 4,
      },
      config: {},
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        matchJobId: "d5f6a7b8-0000-4000-8000-000000000303",
        notified: true,
        status: "notified",
        stubbed: false,
      },
    },
    {
      name: "stays silent when the shortlist is below the threshold",
      input: {
        requirement_id: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        match_job_id: "d5f6a7b8-0000-4000-8000-000000000305",
        result_count: 0,
      },
      config: { minResultsToNotify: 1 },
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        matchJobId: "d5f6a7b8-0000-4000-8000-000000000305",
        notified: false,
        status: "suppressed",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input, config) => {
    const jobId = input.jobId ?? input.requirement_id!;
    const matchJobId = input.match_job_id ?? null;

    // Checked BEFORE the call. An external send that should not happen must
    // not be attempted, not merely ignored afterwards.
    const floor = config.minResultsToNotify;
    if (typeof floor === "number" && (input.result_count ?? 0) < floor) {
      ctx.logger.info("shortlist below notify threshold — not notifying", {
        jobId,
        resultCount: input.result_count ?? 0,
        floor,
      });
      return { jobId, matchJobId, notified: false, status: "suppressed", stubbed: false };
    }

    ctx.logger.info("calling Syntra shortlist notify", { jobId, orgId: ctx.orgId });
    const r = await postSyntra(`/internal/jobs/${jobId}/shortlist/notify`, {
      jobId,
      requirement_id: jobId,
      match_job_id: matchJobId,
      result_count: input.result_count,
    });

    return {
      jobId,
      matchJobId,
      notified: true,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
