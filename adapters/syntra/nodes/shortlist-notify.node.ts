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
  /**
   * Always true: this node calls the endpoint every time, exactly as the engine
   * implementation did. It is kept because run detail's honest answer to "was
   * anyone told?" is the record that the send was attempted, and because a
   * future refusal — if one is ever justified in its own change — has somewhere
   * to report itself.
   */
  notified: z.boolean(),
  status: z.string(),
  stubbed: z.boolean(),
});

/**
 * Empty on purpose.
 *
 * A `minResultsToNotify` suppression threshold was invented during the
 * conversion and has been removed: the engine implementation always called the
 * endpoint, nobody asked for the change, and deciding that a person is NOT told
 * about a shortlist is a product decision, not a conversion detail. If it is
 * wanted, it arrives as its own change with its own argument.
 */
const Config = z.object({});

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
  /**
   * What this node may publish.
   *
   * Sends outward — email, not an internal event. Nothing in the platform
   * waits on this node.
   */
  emits: [],

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
      name: "notifies from the astra producer's requirement_id, with no match job",
      input: {
        requirement_id: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        result_count: 0,
      },
      config: {},
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        matchJobId: null,
        notified: true,
        status: "notified",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input, _config) => {
    const jobId = input.jobId ?? input.requirement_id!;
    const matchJobId = input.match_job_id ?? null;

    ctx.logger.info("calling Syntra shortlist notify", { jobId, orgId: ctx.orgId });
    const r = await postSyntra(`/internal/jobs/${jobId}/shortlist/notify`, {
      jobId,
      requirement_id: jobId,
      match_job_id: matchJobId,
      result_count: input.result_count,
    }, { signal: ctx.signal });

    return {
      jobId,
      matchJobId,
      notified: true,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
