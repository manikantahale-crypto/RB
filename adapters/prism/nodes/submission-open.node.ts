/**
 * prism.submission.open
 *
 * A candidate is going to a vendor for a requirement: the record of that,
 * with a lifecycle, is a PRISM submission. This opens it in DRAFT. Opening
 * one that already exists for the pair answers with the existing one — a
 * workflow that runs twice must not make two.
 *
 * WHO ACTS. Every PRISM row is a recruiter's (`created_by`). A run has no
 * user, so the actor is `actor_id` when the event carries one, else the
 * requirement's owner — the recruiter whose JD this is. PRISM says which
 * it used (`actor_source`), and so does the output.
 *
 * Written 2026-09-20 against `POST /internal/prism/submissions`
 * (node-api/src/modules/prism/routes/internal.prism.routes.js), which was
 * added for it. PRISM had no orchestrator nodes on the old project; the
 * "PRISM pipeline" there was the ASTRA → match → shortlist chain, which is
 * workflows here.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyPrismError, postPrism } from "../prism-http.js";
import { candidateIdOf, jobIdOf } from "../fields.js";

const Input = z
  .object({
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    person_id: z.string().optional(),
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    requirementId: z.string().optional(),
    job_id: z.string().optional(),
    /** The candidate's current resume when absent. */
    resume_id: z.string().optional(),
    resumeId: z.string().optional(),
    /** The match this submission answers, when there is one. */
    match_id: z.string().optional(),
    matchId: z.string().optional(),
    /** The recruiter acting; else the requirement's owner. */
    actor_id: z.string().optional(),
  })
  .refine((v) => Boolean(candidateIdOf(v)), { message: "needs candidate_id" })
  .refine((v) => Boolean(jobIdOf(v)), { message: "needs jobId" });

const Output = z.object({
  submissionId: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  /** DRAFT for a new one; whatever it is for one that existed. */
  status: z.string(),
  /** false when the pair already had an active submission. */
  created: z.boolean(),
  actorSource: z.enum(["payload", "requirement_owner", "unknown"]),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const submissionOpen = defineNode({
  key: "prism.submission.open",
  version: "1.0.0",
  module: "prism",
  shareable: false,

  title: "Open a submission",
  description:
    "Opens a PRISM submission for a candidate against a requirement, as DRAFT, or returns the active one the pair already has, and announces it.",
  tags: ["prism", "submission"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["prism.submission.opened"],
  sideEffect: "internal_write",
  idempotency: {
    strategy: "natural_key",
    keyPaths: [["candidate_id", "candidateId", "person_id"], ["jobId", "requirement_id", "requirementId", "job_id"]],
  },

  execution: {
    /** Three lookups and an insert. UNVERIFIED — not yet timed here. */
    timeoutMs: 20_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyPrismError,
    locks: [],
  },

  dependencies: ["http"],
  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
    {
      name: "a candidate who said yes gets a submission",
      input: { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11" },
      config: {},
      expectedOutput: {
        submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e",
        candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f",
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        status: "DRAFT",
        created: true,
        actorSource: "requirement_owner",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const candidateId = candidateIdOf(input)!;
    const jobId = jobIdOf(input)!;
    ctx.logger.info("calling Prism open submission", { candidateId, jobId, orgId: ctx.orgId });
    const r = await postPrism(
      "/internal/prism/submissions",
      {
        candidateId,
        jobId,
        resumeId: input.resume_id ?? input.resumeId,
        matchId: input.match_id ?? input.matchId,
        actorId: input.actor_id,
      },
      { signal: ctx.signal },
    );

    // The stub opens nothing; an id is invented so a local flow can continue.
    const submissionId = String(r.submission?.id ?? (r.stub ? crypto.randomUUID() : ""));
    if (!submissionId) throw new Error("prism.submission.open: Prism answered without a submission id");
    const status = String(r.submission?.status ?? "DRAFT");
    const created = r.status === "created" || r.stub === true;
    const actorSource = (r.actor_source ?? "unknown") as "payload" | "requirement_owner" | "unknown";

    ctx.emit({
      event_type: "prism.submission.opened",
      payload: { submission_id: submissionId, candidate_id: candidateId, jobId, requirement_id: jobId, status, created },
    });
    return { submissionId, candidateId, jobId, status, created, actorSource, stubbed: r.stub === true };
  },
});
