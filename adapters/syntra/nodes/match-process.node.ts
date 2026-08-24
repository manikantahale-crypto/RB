/**
 * syntra.match.process
 *
 * The ticket's expectation: "Declares an LLM dependency, so a stub and token
 * budget are mandatory." See `dependencies` — this node does not declare one,
 * and the reason is argued there. That argument is the point of this ticket.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

const Input = z
  .object({
    jobId: z.string().min(1).optional(),
    requirement_id: z.string().min(1).optional(),
    resumeId: z.string().min(1),
    candidateId: z.string().min(1).optional(),
    /** Carried by the producer when it already scored a shortlist. */
    skillMatchScore: z.number().optional(),
    match_job_id: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.jobId ?? v.requirement_id), {
    message: "needs jobId (or requirement_id until the binding maps it)",
  });

const Output = z.object({
  jobId: z.string(),
  resumeId: z.string(),
  candidateId: z.string().nullable(),
  skillMatchScore: z.number().nullable(),
  status: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  /** The score at or above which a match is worth a recruiter's attention. */
  matchThreshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .meta({ adminExposed: true, label: "Match threshold" }),
  rerank: z
    .boolean()
    .optional()
    .meta({ adminExposed: true, label: "Re-rank results" }),
  /** Changes what the workflow means, so it is a PR, not an admin form. */
  hardFilters: z.array(z.string()).optional(),
  prompt: z.string().optional(),
});

function optionsFor(config: z.infer<typeof Config>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof config.matchThreshold === "number") out.matchThreshold = config.matchThreshold;
  if (typeof config.rerank === "boolean") out.rerank = config.rerank;
  if (config.hardFilters?.length) out.hardFilters = config.hardFilters;
  if (config.prompt?.trim()) out.prompt = config.prompt.trim();
  return out;
}

export const matchProcess = defineNode({
  key: "syntra.match.process",
  version: "1.0.0",
  module: "syntra",
  shareable: true,

  title: "Score a job against a resume",
  description:
    "Asks SYNTRA to score one requirement against one candidate and record the result, then announces the score.",
  tags: ["syntra", "match", "scoring"],

  input: Input,
  output: Output,
  config: Config,

  /** SYNTRA writes a `syntra.matches` row. Internal to us. */
  sideEffect: "internal_write",

  /**
   * A match is identified by the pair, not by the request. Re-running scores
   * the same pair again and overwrites — it does not append a second row.
   */
  idempotency: { strategy: "natural_key", keyPaths: ["jobId", "resumeId"] },

  execution: {
    /** LLM evaluation happens inside SYNTRA and is the slow part. */
    timeoutMs: 120_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifySyntraError,
    locks: [],
  },

  /**
   * NO `llm` DEPENDENCY, AND THIS IS THE ARGUMENT THE TICKET ASKS FOR.
   *
   * Matching is LLM-backed — but the LLM call happens inside SYNTRA. This node
   * makes one HTTP request. It holds no model client, no API key, and no token
   * count, so:
   *
   *   - a `stub` here would fake an HTTP response, not a model response, which
   *     is what a fixture already does
   *   - a token budget here could not be enforced, because nothing in this
   *     process counts tokens. It would be a number nobody checks
   *
   * Declaring `llm` would make the contract claim something untrue about where
   * the cost lives. `syntra.jd.process` is LLM-backed the same way and declares
   * the same thing, so the two are consistent.
   *
   * OPEN FOR THE LEAD: the platform still has a real need to cap spend when a
   * human clicks TEST THIS NODE against an LLM-backed service. The honest fix
   * is either a separate "costs tokens downstream" flag, or SYNTRA reporting
   * usage back so the editor can show it — not claiming a dependency we do not
   * have. Worth settling before more LLM-backed nodes land.
   */
  dependencies: ["http"],

  /**
   * Identifiers and a score. No resume text, no JD body, nothing personal —
   * and a visible score is exactly what makes a disputed match reviewable.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * HONEST STATUS: hand-written from the response shape, not captured from a
   * live SYNTRA run. Re-capture before the fixture runner lands.
   *
   * Note for the fixture runner: this node is deterministic from OUR side — one HTTP call
   * in, one mapping out — so exact comparison is right. The non-determinism is
   * SYNTRA's, and it is stubbed at that boundary.
   */
  fixtures: [
    {
      name: "scores a pair",
      input: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        resumeId: "b3d4c2a1-0000-4000-8000-000000000101",
        candidateId: "c7e8f9a0-0000-4000-8000-000000000202",
      },
      config: { matchThreshold: 0.75 },
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        resumeId: "b3d4c2a1-0000-4000-8000-000000000101",
        candidateId: "c7e8f9a0-0000-4000-8000-000000000202",
        skillMatchScore: 0.82,
        status: "scored",
        stubbed: false,
      },
    },
    {
      name: "falls back to the score the producer already carried",
      input: {
        requirement_id: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        resumeId: "b3d4c2a1-0000-4000-8000-000000000101",
        skillMatchScore: 0.61,
      },
      config: {},
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        resumeId: "b3d4c2a1-0000-4000-8000-000000000101",
        candidateId: null,
        skillMatchScore: 0.61,
        status: "scored",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input, config) => {
    const jobId = input.jobId ?? input.requirement_id!;
    const candidateId = input.candidateId ?? null;

    ctx.logger.info("calling Syntra match process", {
      jobId,
      resumeId: input.resumeId,
      orgId: ctx.orgId,
    });
    const r = await postSyntra(`/internal/matches/process`, {
      jobId,
      resumeId: input.resumeId,
      candidateId,
      ...optionsFor(config),
    });

    // Prefer SYNTRA's score; fall back to whatever the producer carried in.
    const skillMatchScore =
      r.skillMatchScore ?? r.score ?? r.matchScore ?? input.skillMatchScore ?? null;

    ctx.emit({
      event_type: "syntra.match.completed",
      payload: {
        jobId,
        resumeId: input.resumeId,
        candidateId,
        match_job_id: input.match_job_id ?? crypto.randomUUID(),
        requirement_id: jobId,
        skillMatchScore,
        result_count: 1,
        top_score: skillMatchScore,
        status: r.status,
        syntra: r,
      },
    });

    return {
      jobId,
      resumeId: input.resumeId,
      candidateId,
      skillMatchScore,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
