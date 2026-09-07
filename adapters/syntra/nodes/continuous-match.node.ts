/**
 * syntra.continuous.match
 *
 * The question this node had to answer: "It writes. Cannot be `pure`. Pick the natural key and defend it."
 * The defence is in `idempotency`, and it comes with a caveat that a reviewer
 * should push on.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

const Input = z
  .object({
    jobId: z.string().min(1).optional(),
    requirement_id: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.jobId ?? v.requirement_id), {
    message: "needs jobId or requirement_id",
  });

const Output = z.object({
  jobId: z.string(),
  matchJobId: z.string(),
  resultCount: z.number().int().min(0),
  topScore: z.number().nullable(),
  status: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  matchThreshold: z.number().min(0).max(1).optional().meta({ adminExposed: true }),
});

export const continuousMatch = defineNode({
  key: "syntra.continuous.match",
  version: "1.0.0",
  module: "syntra",
  shareable: true,

  title: "Match a requirement against the bench",
  description:
    "Once a requirement is parsed, asks SYNTRA to search the whole bench for candidates who fit it, and announces how many were found.",
  tags: ["syntra", "match", "bench"],

  input: Input,
  output: Output,
  config: Config,

  /** SYNTRA creates a match job and writes match rows. */
  /**
   * What this node may publish.
   *
   * Bench-wide matching, publishing the same event as the single-pair
   * node for the same reason.
   */
  emits: ["syntra.match.completed"],

  sideEffect: "internal_write",

  /**
   * THE ARGUMENT.
   *
   * The requirement id is the natural key: one continuous match per
   * requirement. A retry after a network timeout should re-run the search for
   * the same requirement, not open a second one.
   *
   * THE CAVEAT, AND IT IS REAL. Unlike the pair-keyed nodes, this one creates
   * a match JOB, and the implementation falls back to a fresh id when SYNTRA
   * does not return one (`r.match_job_id ?? uuid()`). If SYNTRA opens a new
   * job per request rather than reusing the one keyed to the requirement, a
   * retry produces two jobs and the bench gets searched twice.
   *
   * Retries are therefore capped at 1, not 3 — one cautious re-attempt for a
   * genuine blip, rather than three chances to duplicate work.
   *
   * REVIEWER: this needs confirming with the SYNTRA team, not assuming. If
   * their endpoint is not keyed on the requirement, the right fix is on their
   * side, and this line becomes accurate rather than hopeful.
   */
  idempotency: { strategy: "natural_key", keyPaths: ["jobId"] },

  execution: {
    /** Searches the entire bench — the slowest node we have. */
    timeoutMs: 180_000,
    retry: { limit: 1, backoff: "exponential", baseMs: 5_000 },
    classifyError: classifySyntraError,
    /** One bench search per requirement at a time. */
    locks: ["syntra.continuous-match"],
  },

  dependencies: ["http"],

  /** A requirement id and a count. Nothing about any individual candidate. */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * STATUS: corrected against the handler that produces the response —
   * `node-api/src/routes/internal.routes.js`
   * `POST /internal/jobs/:id/continuous-match`, which answers
   * `{ status: "ok", jobId, result_count, match_job_id, top_score, poolSize,
   * finalists }`. `status` was guessed as "completed"; SYNTRA says "ok". The
   * three field names the node reads were right.
   *
   * ⚠ THE SECOND FIXTURE CANNOT PASS EXACT COMPARISON, AND THAT IS A NODE BUG,
   * NOT A FIXTURE BUG. `match_job_id` is `created[0]?.matchId ?? null`, so a
   * search finding nobody returns null — and `run` then MINTS a random uuid for
   * it (`r.match_job_id ?? crypto.randomUUID()`). The node's output is
   * therefore non-deterministic in exactly the case this fixture pins, and no
   * value written here can be right.
   *
   * Left as-is rather than quietly deleted, because the fixture is correct
   * about the behaviour that matters (nobody found, count 0, no score) and the
   * runner failing on it is the signal that should start the argument: should a
   * node invent an id for a match job SYNTRA never created? A run detail
   * showing a match job id that exists nowhere is worse than a null.
   *
   * Still NOT captured from a live run — read from the source of the response.
   */
  fixtures: [
    {
      name: "finds candidates on the bench",
      input: { jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
      config: {},
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        matchJobId: "d5f6a7b8-0000-4000-8000-000000000303",
        resultCount: 4,
        topScore: 0.88,
        status: "ok",
        stubbed: false,
      },
    },
    {
      name: "finds nobody, which is a normal outcome",
      input: { requirement_id: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
      config: {},
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        matchJobId: "d5f6a7b8-0000-4000-8000-000000000304",
        resultCount: 0,
        topScore: null,
        status: "ok",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const jobId = input.jobId ?? input.requirement_id!;

    ctx.logger.info("calling Syntra continuous match", { jobId, orgId: ctx.orgId });
    const r = await postSyntra(`/internal/jobs/${jobId}/continuous-match`, {
      jobId,
      requirement_id: jobId,
    });

    const matchJobId = String(r.match_job_id ?? crypto.randomUUID());
    const resultCount = Number(r.result_count ?? 0);
    const topScore = r.top_score ?? null;

    ctx.emit({
      event_type: "syntra.match.completed",
      payload: {
        jobId,
        requirement_id: jobId,
        match_job_id: matchJobId,
        result_count: resultCount,
        top_score: topScore,
        status: r.status,
        syntra: r,
      },
    });

    return {
      jobId,
      matchJobId,
      resultCount,
      topScore,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
