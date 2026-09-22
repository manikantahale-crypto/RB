/**
 * prism.vendor.record
 *
 * The vendor answered the submission — accepted or rejected. This writes
 * that on the submission: VENDOR_SUBMITTED → VENDOR_ACCEPTED or REJECTED.
 * Which submission is PRISM's to work out (by id, then candidate + job,
 * then the vendor's email against the requirement's vendor); an answer it
 * cannot place is reported, not guessed.
 *
 * Written 2026-09-20 against `POST /internal/prism/vendor/response`, the
 * inbound handler RELAY already calls.
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
    message: "needs the vendor's answer — decision, response or approved",
  })
  .refine((v) => Boolean(submissionIdOf(v) ?? candidateIdOf(v) ?? v.sender_email ?? v.senderEmail), {
    message: "needs a submission_id, a candidate_id or the sender's email to find the submission by",
  });

const Output = z.object({
  status: z.string(),
  submissionId: z.string().nullable(),
  response: z.enum(["ACCEPTED", "REJECTED"]),
  newStatus: z.string().nullable(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

function normalize(input: { decision?: string; response?: string; approved?: boolean }): "ACCEPTED" | "REJECTED" {
  if (typeof input.approved === "boolean") return input.approved ? "ACCEPTED" : "REJECTED";
  const word = String(input.decision ?? input.response ?? "").toUpperCase();
  return ["YES", "APPROVED", "ACCEPTED", "TRUE"].includes(word) ? "ACCEPTED" : "REJECTED";
}

export const vendorRecord = defineNode({
  key: "prism.vendor.record",
  version: "1.0.0",
  module: "prism",
  shareable: true, // the answer arrives through RELAY, so RELAY's flow records it

  title: "Record the vendor's answer",
  description:
    "Writes the vendor's accept or reject on the PRISM submission they were sent and announces what was recorded.",
  tags: ["prism", "vendor", "submission"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["prism.vendor.recorded"],
  sideEffect: "internal_write",
  idempotency: {
    strategy: "natural_key",
    keyPaths: [["submissionId", "submission_id", "candidate_id", "candidateId", "sender_email", "senderEmail"], ["decision", "response", "approved"]],
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
      name: "the vendor accepts",
      input: { submission_id: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", response: "ACCEPTED" },
      config: {},
      expectedOutput: { status: "success", submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", response: "ACCEPTED", newStatus: "VENDOR_ACCEPTED", stubbed: false },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const response = normalize(input);
    const submissionId = submissionIdOf(input);
    const candidateId = candidateIdOf(input);
    const jobId = jobIdOf(input);
    ctx.logger.info("calling Prism vendor response", { submissionId, candidateId, jobId, response, orgId: ctx.orgId });
    const r = await postPrism(
      "/internal/prism/vendor/response",
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
      event_type: "prism.vendor.recorded",
      payload: { submission_id: out.submissionId, candidate_id: candidateId ?? null, jobId: jobId ?? null, response, status: out.status, new_status: out.newStatus },
    });
    return out;
  },
});
