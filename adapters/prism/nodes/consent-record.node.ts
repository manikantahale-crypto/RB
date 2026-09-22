/**
 * prism.consent.record
 *
 * A candidate answered the consent email — yes or no — and RELAY published
 * `relay.consent.decided`. This writes that answer on the candidate's
 * submission: yes moves it PENDING_CONSENT → CANDIDATE_VALIDATED, no →
 * CONSENT_REJECTED. Finding WHICH submission is PRISM's business (it
 * correlates by submission id, then candidate + job, then sender + job, and
 * refuses to guess across candidates); an answer it cannot place is
 * reported as such, not forced onto someone.
 *
 * Written 2026-09-20 against `POST /internal/prism/consent/response`, the
 * inbound handler RELAY already calls directly. From a workflow the call is
 * the same; what changes is that it is a step on the run's record.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyPrismError, postPrism } from "../prism-http.js";
import { candidateIdOf, jobIdOf, submissionIdOf } from "../fields.js";

const Input = z
  .object({
    submissionId: z.string().optional(),
    submission_id: z.string().optional(),
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    /** What RELAY's consent parser decided: approved / rejected / yes / no. */
    decision: z.string().optional(),
    response: z.string().optional(),
    approved: z.boolean().optional(),
    sender_email: z.string().optional(),
    senderEmail: z.string().optional(),
    thread_id: z.string().optional(),
    relay_thread_id: z.string().optional(),
    body_snippet: z.string().optional(),
    message_id: z.string().optional(),
  })
  .refine((v) => v.decision !== undefined || v.response !== undefined || v.approved !== undefined, {
    message: "needs the candidate's answer — decision, response or approved",
  })
  .refine((v) => Boolean(submissionIdOf(v) ?? candidateIdOf(v)), {
    message: "needs a submission_id or a candidate_id to find the submission by",
  });

const Output = z.object({
  /** success | already_processed | ambiguous_or_not_found — PRISM's word. */
  status: z.string(),
  submissionId: z.string().nullable(),
  /** ACCEPTED or REJECTED, as recorded. */
  response: z.enum(["ACCEPTED", "REJECTED"]),
  newStatus: z.string().nullable(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

/** RELAY says approved/rejected/timeout, a person says yes/no; PRISM wants ACCEPTED/REJECTED. */
function normalize(input: { decision?: string; response?: string; approved?: boolean }): "ACCEPTED" | "REJECTED" {
  if (typeof input.approved === "boolean") return input.approved ? "ACCEPTED" : "REJECTED";
  const word = String(input.decision ?? input.response ?? "").toUpperCase();
  return ["YES", "APPROVED", "ACCEPTED", "GRANTED", "TRUE"].includes(word) ? "ACCEPTED" : "REJECTED";
}

export const consentRecord = defineNode({
  key: "prism.consent.record",
  version: "1.0.0",
  module: "prism",
  shareable: true, // the answer arrives through RELAY, so RELAY's flow records it

  title: "Record the candidate's consent answer",
  description:
    "Writes a candidate's yes or no on their PRISM submission — validated on yes, consent-rejected on no — and announces what was recorded.",
  tags: ["prism", "consent", "submission"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["prism.consent.recorded"],
  sideEffect: "internal_write",
  idempotency: {
    strategy: "natural_key",
    keyPaths: [["submissionId", "submission_id", "candidate_id", "candidateId"], ["decision", "response", "approved"]],
  },

  execution: {
    /** A few lookups and one transition. UNVERIFIED — not yet timed here. */
    timeoutMs: 20_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyPrismError,
    locks: [],
  },

  dependencies: ["http"],
  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
    {
      name: "a yes validates the candidate",
      input: { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11", decision: "approved" },
      config: {},
      expectedOutput: { status: "success", submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", response: "ACCEPTED", newStatus: "CANDIDATE_VALIDATED", stubbed: false },
    },
    {
      name: "a no is recorded as consent rejected",
      input: { submission_id: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", response: "no" },
      config: {},
      expectedOutput: { status: "success", submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", response: "REJECTED", newStatus: "CONSENT_REJECTED", stubbed: false },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const response = normalize(input);
    const submissionId = submissionIdOf(input);
    const candidateId = candidateIdOf(input);
    const jobId = jobIdOf(input);
    ctx.logger.info("calling Prism consent response", { submissionId, candidateId, jobId, response, orgId: ctx.orgId });
    const r = await postPrism(
      "/internal/prism/consent/response",
      {
        submissionId,
        candidateId,
        jobId,
        senderEmail: input.sender_email ?? input.senderEmail,
        response,
        notes: input.body_snippet,
        messageId: input.message_id,
        threadId: input.thread_id ?? input.relay_thread_id,
      },
      { signal: ctx.signal },
    );

    const out = {
      status: String(r.status ?? (r.stub ? "success" : "unknown")),
      submissionId: (r.submissionId ?? submissionId ?? null) as string | null,
      response,
      newStatus: (r.newStatus ?? r.currentStatus ?? null) as string | null,
      stubbed: r.stub === true,
    };
    ctx.emit({
      event_type: "prism.consent.recorded",
      payload: {
        submission_id: out.submissionId,
        candidate_id: candidateId ?? null,
        jobId: jobId ?? null,
        response,
        status: out.status,
        new_status: out.newStatus,
      },
    });
    return out;
  },
});
