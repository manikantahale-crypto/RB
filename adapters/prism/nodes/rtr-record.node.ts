/**
 * prism.rtr.record
 *
 * The Right-To-Represent came back — signed or declined. This writes it on
 * the submission: PENDING_RTR → RTR_CONFIRMED, or REJECTED. RTR is in
 * PRISM's name ("Submission & RTR Control"); this is the tracking half. The
 * document itself is RELAY's inbox business; PRISM finds the submission by
 * id, then by job and the sender's email.
 *
 * Written 2026-09-20 against `POST /internal/prism/rtr/response`, the
 * inbound handler RELAY already calls.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyPrismError, postPrism } from "../prism-http.js";
import { jobIdOf, submissionIdOf } from "../fields.js";

const Input = z
  .object({
    submissionId: z.string().optional(),
    submission_id: z.string().optional(),
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    /** signed / confirmed / yes -> SIGNED; anything else -> DECLINED. */
    decision: z.string().optional(),
    response: z.string().optional(),
    signed: z.boolean().optional(),
    sender_email: z.string().optional(),
    senderEmail: z.string().optional(),
    body_snippet: z.string().optional(),
    message_id: z.string().optional(),
  })
  .refine((v) => v.decision !== undefined || v.response !== undefined || v.signed !== undefined, {
    message: "needs the answer — decision, response or signed",
  })
  .refine((v) => Boolean(submissionIdOf(v) ?? (jobIdOf(v) && (v.sender_email ?? v.senderEmail))), {
    message: "needs a submission_id, or a jobId with the sender's email",
  });

const Output = z.object({
  status: z.string(),
  submissionId: z.string().nullable(),
  rtrStatus: z.enum(["SIGNED", "DECLINED"]),
  newStatus: z.string().nullable(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

function normalize(input: { decision?: string; response?: string; signed?: boolean }): "SIGNED" | "DECLINED" {
  if (typeof input.signed === "boolean") return input.signed ? "SIGNED" : "DECLINED";
  const word = String(input.decision ?? input.response ?? "").toUpperCase();
  return ["YES", "APPROVED", "ACCEPTED", "SIGNED", "CONFIRMED", "TRUE"].includes(word) ? "SIGNED" : "DECLINED";
}

export const rtrRecord = defineNode({
  key: "prism.rtr.record",
  version: "1.0.0",
  module: "prism",
  shareable: false,

  title: "Record the Right-To-Represent answer",
  description:
    "Writes whether the RTR came back signed or declined on the PRISM submission waiting for it and announces what was recorded.",
  tags: ["prism", "rtr", "submission"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["prism.rtr.recorded"],
  sideEffect: "internal_write",
  idempotency: {
    strategy: "natural_key",
    keyPaths: [["submissionId", "submission_id", "sender_email", "senderEmail"], ["decision", "response", "signed"]],
  },

  execution: {
    /** A lookup and one transition. UNVERIFIED — not yet timed here. */
    timeoutMs: 20_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyPrismError,
    locks: [],
  },

  dependencies: ["http"],
  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
    {
      name: "a signed RTR confirms the submission",
      input: { submission_id: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", response: "signed" },
      config: {},
      expectedOutput: { status: "success", submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", rtrStatus: "SIGNED", newStatus: "RTR_CONFIRMED", stubbed: false },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const rtrStatus = normalize(input);
    const submissionId = submissionIdOf(input);
    const jobId = jobIdOf(input);
    ctx.logger.info("calling Prism RTR response", { submissionId, jobId, rtrStatus, orgId: ctx.orgId });
    const r = await postPrism(
      "/internal/prism/rtr/response",
      {
        submissionId,
        jobId,
        response: rtrStatus,
        notes: input.body_snippet,
        messageId: input.message_id,
        senderEmail: input.sender_email ?? input.senderEmail,
      },
      { signal: ctx.signal },
    );
    const out = {
      status: String(r.status ?? (r.stub ? "success" : "unknown")),
      submissionId: (r.submissionId ?? submissionId ?? null) as string | null,
      rtrStatus,
      newStatus: (r.newStatus ?? r.currentStatus ?? null) as string | null,
      stubbed: r.stub === true,
    };
    ctx.emit({
      event_type: "prism.rtr.recorded",
      payload: { submission_id: out.submissionId, jobId: jobId ?? null, rtr_status: rtrStatus, status: out.status, new_status: out.newStatus },
    });
    return out;
  },
});
