/**
 * prism.submission.transition
 *
 * Move a submission to the next status the matrix allows — VENDOR_SUBMITTED
 * after RELAY sent the profile, RATE_CONFIRMED with a rate, PENDING_RTR
 * with a document, WITHDRAWN. PRISM's matrix (prism.workflow.service.js
 * §2) decides what is allowed from where; a move it refuses is the input's
 * fault. A submission already at the target is `already_processed`.
 *
 * Written 2026-09-20 against `POST /internal/prism/submissions/:id/transition`,
 * added for it. The status is a SETTING as well as an input: a step in a
 * definition is "move to VENDOR_SUBMITTED" — the event need not say so.
 *
 * RECORDS, NEVER SENDS. PRISM's own UI actions for PENDING_CONSENT and
 * VENDOR_SUBMITTED send mail through RELAY on the way; the endpoint behind
 * this node does not (the roadmap: RELAY is the communication layer, PRISM
 * keeps the record). In a workflow the order is `relay.consent.send` → this
 * node to PENDING_CONSENT; `relay.profile.send` → this node to
 * VENDOR_SUBMITTED. And the roadmap's rule 4 — submissions and rates need a
 * person's authorization — is the workflow's to keep: a `human.gate` before
 * the send, not something this node can enforce.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyPrismError, postPrism } from "../prism-http.js";
import { submissionIdOf } from "../fields.js";

/** PRISM's own list (prism.workflow.service.js WORKFLOW_STATUSES). */
export const PRISM_STATUSES = [
  "DRAFT",
  "PENDING_CONSENT",
  "CONSENT_REJECTED",
  "CANDIDATE_VALIDATED",
  "MASKED",
  "VENDOR_SUBMITTED",
  "VENDOR_ACCEPTED",
  "VENDOR_VALIDATED",
  "AVAILABILITY_CONFIRMED",
  "RATE_CONFIRMED",
  "PENDING_RTR",
  "RTR_CONFIRMED",
  "INTERVIEW_SCHEDULED",
  "READY",
  "SUBMITTED",
  "REJECTED",
  "WITHDRAWN",
] as const;

const Input = z
  .object({
    submissionId: z.string().optional(),
    submission_id: z.string().optional(),
    /** Where to, when the event says rather than the step. */
    target_status: z.enum(PRISM_STATUSES).optional(),
    targetStatus: z.enum(PRISM_STATUSES).optional(),
    /** What that transition reads: rate, rateType, availability, documentUrl, notes, … */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Boolean(submissionIdOf(v)), { message: "needs submission_id" });

const Output = z.object({
  submissionId: z.string(),
  status: z.string(),
  previousStatus: z.string().nullable(),
  newStatus: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  /** The status this step moves to. The event's `target_status` wins when present. */
  targetStatus: z.enum(PRISM_STATUSES).optional().meta({ adminExposed: true, label: "Move to" }),
  agentName: z.string().optional(),
});

export const submissionTransition = defineNode({
  key: "prism.submission.transition",
  version: "1.0.0",
  module: "prism",
  shareable: false,

  title: "Move a submission along",
  description:
    "Moves a PRISM submission to a status its lifecycle allows from where it is, with whatever that step needs, and announces the move.",
  tags: ["prism", "submission", "lifecycle"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["prism.submission.transitioned"],
  /** A row and an audit line. Nothing leaves the company — see the header. */
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["submissionId", "submission_id"], ["target_status", "targetStatus"]] },

  execution: {
    /** One transition; some send mail through RELAY on the way. UNVERIFIED — not yet timed here. */
    timeoutMs: 45_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyPrismError,
    locks: [],
  },

  dependencies: ["http"],
  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
    {
      name: "the profile went to the vendor",
      input: { submission_id: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e" },
      config: { targetStatus: "VENDOR_SUBMITTED" },
      expectedOutput: {
        submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e",
        status: "success",
        previousStatus: "MASKED",
        newStatus: "VENDOR_SUBMITTED",
        stubbed: false,
      },
    },
    {
      name: "the rate is confirmed, from the event",
      input: { submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e", target_status: "RATE_CONFIRMED", metadata: { rate: 95, rateType: "HOURLY" } },
      config: {},
      expectedOutput: {
        submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e",
        status: "success",
        previousStatus: "AVAILABILITY_CONFIRMED",
        newStatus: "RATE_CONFIRMED",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input, config) => {
    const submissionId = submissionIdOf(input)!;
    const targetStatus = input.target_status ?? input.targetStatus ?? config.targetStatus;
    if (!targetStatus) {
      throw new Error("prism.submission.transition: no target status — set it on the step or send target_status");
    }
    ctx.logger.info("calling Prism transition", { submissionId, targetStatus, orgId: ctx.orgId });
    const r = await postPrism(
      `/internal/prism/submissions/${submissionId}/transition`,
      { targetStatus, metadata: input.metadata ?? {} },
      { signal: ctx.signal },
    );
    const out = {
      submissionId,
      status: String(r.status ?? (r.stub ? "success" : "unknown")),
      previousStatus: (r.previousStatus ?? null) as string | null,
      newStatus: String(r.newStatus ?? targetStatus),
      stubbed: r.stub === true,
    };
    ctx.emit({
      event_type: "prism.submission.transitioned",
      payload: { submission_id: submissionId, previous_status: out.previousStatus, new_status: out.newStatus, status: out.status },
    });
    return out;
  },
});
