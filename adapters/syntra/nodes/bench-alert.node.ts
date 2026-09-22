/**
 * syntra.bench.alert
 *
 * The question this node had to answer: "Internal write or external? If anything leaves the building it
 * needs an allowlist." The answer is `internal_write`, and the reasoning is in
 * `sideEffect` — along with the one thing a reviewer must verify.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifySyntraError, postSyntra } from "../syntra-http.js";

const Input = z
  .object({
    candidateId: z.string().min(1).optional(),
    candidate_id: z.string().min(1).optional(),
    candidate_profile_id: z.string().min(1).optional(),
    resumeId: z.string().min(1).optional(),
    document_id: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.candidateId ?? v.candidate_id), {
    message: "needs candidateId or candidate_id",
  });

const Output = z.object({
  candidateId: z.string(),
  /** True when a live requirement was found worth scoring this person against. */
  matchRequested: z.boolean(),
  jobId: z.string().nullable(),
  status: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  minScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .meta({ adminExposed: true, label: "Minimum score to raise an alert" }),
});

export const benchAlert = defineNode({
  key: "syntra.bench.alert",
  version: "1.0.0",
  module: "syntra",
  shareable: true, // telling a recruiter about matches is not SYNTRA's alone to do

  title: "Alert on a bench candidate",
  description:
    "Once a candidate profile is ready, asks SYNTRA whether any live requirement suits them, and requests a full score when one does.",
  tags: ["syntra", "bench", "alert"],

  input: Input,
  output: Output,
  config: Config,

  /**
   * THE ARGUMENT THE TICKET ASKS FOR.
   *
   * "Alert" sounds external — an email to a recruiter, a message in a channel.
   * It is not, and the endpoint is the evidence: this node POSTs to
   * `/internal/candidates/{id}/bench-alert` and, on a hit, emits
   * `syntra.match.requested`, which is a fact that travels back through our own
   * front door. Nothing addressed to a person leaves this process.
   *
   * The test is: if this ran twice by accident, would someone OUTSIDE the
   * company notice? No — they would get one extra internal scoring request.
   *
   * REVIEWER, VERIFY THIS ONE THING: if SYNTRA's bench-alert endpoint itself
   * sends an email or a push notification, then the external effect exists, it
   * is simply one hop away — and the allowlist entry belongs on whichever node
   * or module actually sends. This declaration describes what THIS node does.
   * It is worth a direct question to the SYNTRA team rather than an assumption
   * either way.
   */
  /**
   * What this node may publish.
   *
   * Asks for matching to happen; it does not do the matching itself.
   */
  emits: ["syntra.match.requested"],

  sideEffect: "internal_write",

  /**
   * Keyed on the candidate. One bench alert per profile: a retry re-asks about
   * the same person rather than raising a second scoring request for them.
   */
  idempotency: {
    strategy: "natural_key",
    // The refine says candidateId or candidate_id; syntra.profile.prepared
    // carries candidate_id. candidate_profile_id is accepted by the input but
    // is NOT an alternative here — a profile version is not a candidate, and
    // keying on it would merge work that is genuinely different.
    keyPaths: [["candidateId", "candidate_id"]],
  },

  execution: {
    // Measured, not guessed. The endpoint runs the whole matching funnel
    // inline — vector shortlist, skill floor, then LLM scoring per open
    // requirement — and on 2026-09-18 a real candidate took over 240 s
    // (ref/SYNTRA_Onboarding.md, stage 4). 60 s was the number written before
    // anyone timed it, and the runtime now enforces this field, so a wrong
    // one fails the step every time. The fix that brings this down is in
    // SYNTRA: score asynchronously and answer with the shortlist.
    timeoutMs: 300_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifySyntraError,
    locks: [],
  },

  dependencies: ["http"],

  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /** HONEST STATUS: hand-written, not captured. Re-capture before the fixture runner lands. */
  fixtures: [
    {
      name: "finds a live requirement and asks for a score",
      input: {
        candidateId: "c7e8f9a0-0000-4000-8000-000000000202",
        resumeId: "b3d4c2a1-0000-4000-8000-000000000101",
      },
      config: { minScore: 0.7 },
      expectedOutput: {
        candidateId: "c7e8f9a0-0000-4000-8000-000000000202",
        matchRequested: true,
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        status: "alerted",
        stubbed: false,
      },
    },
    {
      name: "finds no suitable requirement",
      input: { candidate_id: "c7e8f9a0-0000-4000-8000-000000000202" },
      config: {},
      expectedOutput: {
        candidateId: "c7e8f9a0-0000-4000-8000-000000000202",
        matchRequested: false,
        jobId: null,
        status: "no_match",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const candidateId = input.candidateId ?? input.candidate_id!;
    const resumeId = input.resumeId ?? input.document_id ?? null;

    ctx.logger.info("calling Syntra bench alert", { candidateId, orgId: ctx.orgId });
    const r = await postSyntra(`/internal/candidates/${candidateId}/bench-alert`, {
      candidateId,
      candidate_profile_id: input.candidate_profile_id,
    }, { signal: ctx.signal });

    const jobId = (r.jobId ?? r.requirement_id ?? null) as string | null;

    // Needs BOTH sides to score a pair. Having a requirement but no resume id
    // is not an error — there is simply nothing to request yet.
    const matchRequested = Boolean(jobId && resumeId);
    if (matchRequested) {
      ctx.emit({
        event_type: "syntra.match.requested",
        payload: {
          candidateId,
          jobId,
          resumeId,
          status: r.status,
          syntra: r,
        },
      });
    }

    return {
      candidateId,
      matchRequested,
      jobId,
      status: String(r.status ?? "ok"),
      stubbed: r.stub === true,
    };
  },
});
