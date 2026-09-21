/**
 * prism.confirmation.record
 *
 * Rate and availability are confirmed by two parties — the consultant and
 * the vendor — and each answers by mail. This writes one party's answer on
 * the submission (the next status is PRISM's functions' to decide, or a
 * decline). The roadmap's rule 4 says rates need a person's authorization:
 * that is the recruiter's confirmation request, sent before this answer can
 * exist.
 *
 * Written 2026-09-20 against `POST /internal/prism/confirmation/response`,
 * the inbound handler RELAY already calls.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyPrismError, postPrism } from "../prism-http.js";
import { candidateIdOf, jobIdOf, submissionIdOf } from "../fields.js";

const Party = z.enum(["CONSULTANT", "VENDOR"]);

const Input = z
  .object({
    submissionId: z.string().optional(),
    submission_id: z.string().optional(),
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    /** Who answered. */
    party: z.string().optional(),
    decision: z.string().optional(),
    response: z.string().optional(),
    confirmed: z.boolean().optional(),
    sender_email: z.string().optional(),
    senderEmail: z.string().optional(),
    body_snippet: z.string().optional(),
    message_id: z.string().optional(),
  })
  .refine((v) => v.decision !== undefined || v.response !== undefined || v.confirmed !== undefined, {
    message: "needs the answer — decision, response or confirmed",
  })
  .refine((v) => Boolean(submissionIdOf(v) ?? candidateIdOf(v) ?? v.sender_email ?? v.senderEmail), {
    message: "needs a submission_id, a candidate_id or the sender's email to find the submission by",
  });

const Output = z.object({
  status: z.string(),
  submissionId: z.string().nullable(),
  party: Party,
  confirmationStatus: z.enum(["CONFIRMED", "DECLINED"]),
  newStatus: z.string().nullable(),
  stubbed: z.boolean(),
});

const Config = z.object({
  /** Which party this step records, when the event does not say. */
  party: Party.optional().meta({ adminExposed: true, label: "Answering party" }),
  agentName: z.string().optional(),
});

function normalize(input: { decision?: string; response?: string; confirmed?: boolean }): "CONFIRMED" | "DECLINED" {
  if (typeof input.confirmed === "boolean") return input.confirmed ? "CONFIRMED" : "DECLINED";
  const word = String(input.decision ?? input.response ?? "").toUpperCase();
  return ["YES", "APPROVED", "ACCEPTED", "CONFIRMED", "TRUE"].includes(word) ? "CONFIRMED" : "DECLINED";
}

export const confirmationRecord = defineNode({
  key: "prism.confirmation.record",
  version: "1.0.0",
  module: "prism",
  shareable: false,

  title: "Record a rate or availability confirmation",
  description:
    "Writes the consultant's or the vendor's confirmation of rate and availability on the PRISM submission and announces what was recorded.",
  tags: ["prism", "confirmation", "rate", "availability", "submission"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["prism.confirmation.recorded"],
  sideEffect: "internal_write",
  idempotency: {
    strategy: "natural_key",
    keyPaths: [["submissionId", "submission_id", "candidate_id", "candidateId", "sender_email", "senderEmail"], "party", ["decision", "response", "confirmed"]],
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
      name: "the consultant confirms",
      input: { submission_id: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", party: "consultant", response: "confirmed" },
      config: {},
      expectedOutput: { status: "success", submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", party: "CONSULTANT", confirmationStatus: "CONFIRMED", newStatus: "AVAILABILITY_CONFIRMED", stubbed: false },
    },
    {
      name: "the vendor declines, the party set on the step",
      input: { submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", decision: "no" },
      config: { party: "VENDOR" },
      expectedOutput: { status: "success", submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", party: "VENDOR", confirmationStatus: "DECLINED", newStatus: "REJECTED", stubbed: false },
    },
  ],

  run: async (ctx: NodeRunCtx, input, config) => {
    const partyWord = String(input.party ?? config.party ?? "").toUpperCase();
    if (partyWord !== "CONSULTANT" && partyWord !== "VENDOR") {
      throw new Error("prism.confirmation.record: no party — set it on the step or send party");
    }
    const party = partyWord as "CONSULTANT" | "VENDOR";
    const confirmationStatus = normalize(input);
    const submissionId = submissionIdOf(input);
    ctx.logger.info("calling Prism confirmation response", { submissionId, party, confirmationStatus, orgId: ctx.orgId });
    const r = await postPrism(
      "/internal/prism/confirmation/response",
      {
        submissionId,
        candidateId: candidateIdOf(input),
        jobId: jobIdOf(input),
        party,
        response: confirmationStatus,
        notes: input.body_snippet,
        messageId: input.message_id,
        senderEmail: input.sender_email ?? input.senderEmail,
      },
      { signal: ctx.signal },
    );
    const out = {
      status: String(r.status ?? (r.stub ? "success" : "unknown")),
      submissionId: (r.submissionId ?? submissionId ?? null) as string | null,
      party,
      confirmationStatus,
      newStatus: (r.newStatus ?? r.currentStatus ?? null) as string | null,
      stubbed: r.stub === true,
    };
    ctx.emit({
      event_type: "prism.confirmation.recorded",
      payload: { submission_id: out.submissionId, party, confirmation_status: confirmationStatus, status: out.status, new_status: out.newStatus },
    });
    return out;
  },
});
