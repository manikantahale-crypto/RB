/**
 * prism.profile.mask
 *
 * Before a profile goes to a vendor, PRISM builds the masked version — a
 * reference in place of the name, headline, years, skills, location, rate,
 * availability, summary — and moves the submission CANDIDATE_VALIDATED →
 * MASKED. The masked profile is the output, and it is what
 * `relay.profile.send` takes as `masked_profile`: map it in
 * (`profile.masked_profile ← mask.maskedProfile`).
 *
 * Written 2026-09-20 against `POST /internal/prism/submissions/:id/mask`,
 * added for it. A submission already MASKED answers with its profile.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyPrismError, postPrism } from "../prism-http.js";
import { submissionIdOf } from "../fields.js";

const Input = z
  .object({
    submissionId: z.string().optional(),
    submission_id: z.string().optional(),
    /** A recruiter-edited profile to use instead of PRISM's own masking. */
    masked_profile: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Boolean(submissionIdOf(v)), { message: "needs submission_id" });

const Output = z.object({
  submissionId: z.string(),
  status: z.string(),
  maskedProfile: z.record(z.string(), z.unknown()),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const profileMask = defineNode({
  key: "prism.profile.mask",
  version: "1.0.0",
  module: "prism",
  shareable: false,

  title: "Mask the profile for the vendor",
  description:
    "Has PRISM build the masked profile — reference, headline, skills, rate, no name or contact — on a validated submission and announces it, ready for RELAY to send.",
  tags: ["prism", "submission", "masking", "redaction"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["prism.profile.masked"],
  sideEffect: "internal_write",
  idempotency: { strategy: "natural_key", keyPaths: [["submissionId", "submission_id"]] },

  execution: {
    /** Three lookups and one transition. UNVERIFIED — not yet timed here. */
    timeoutMs: 20_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 2_000 },
    classifyError: classifyPrismError,
    locks: [],
  },

  dependencies: ["http"],
  /** The profile is the candidate's, masked or not; not rendered on run detail. */
  persistence: { storeInput: "redact", storeOutput: "redact", redactPaths: ["masked_profile", "maskedProfile"] },

  fixtures: [
    {
      name: "a validated submission is masked",
      input: { submission_id: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e" },
      config: {},
      expectedOutput: {
        submissionId: "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e",
        status: "MASKED",
        maskedProfile: { maskedCandidateId: "CAND-21D2CB25", headline: "SAP ABAP Consultant", skills: ["ABAP"] },
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const submissionId = submissionIdOf(input)!;
    ctx.logger.info("calling Prism mask", { submissionId, orgId: ctx.orgId });
    const r = await postPrism(
      `/internal/prism/submissions/${submissionId}/mask`,
      input.masked_profile ? { maskedProfile: input.masked_profile } : {},
      { signal: ctx.signal },
    );
    const maskedProfile = (r.maskedProfile ?? (r.stub ? { stub: true } : null)) as Record<string, unknown> | null;
    if (!maskedProfile) throw new Error("prism.profile.mask: Prism answered without a masked profile");
    const status = String(r.newStatus ?? r.currentStatus ?? "MASKED");

    ctx.emit({
      event_type: "prism.profile.masked",
      payload: { submission_id: submissionId, status, masked_profile: maskedProfile },
    });
    return { submissionId, status, maskedProfile, stubbed: r.stub === true };
  },
});
