/**
 * relay.profile.send
 *
 * A candidate said yes. RELAY writes the submission email from the MASKED
 * profile — a reference like CAND-21D2CB25, headline, years, skills,
 * location, rate, availability, summary; never the name or contact — and
 * sends it to the vendor, on the vendor's own JD thread when there is one.
 * The redaction is RELAY's and happens before anything leaves; this node
 * hands over what PRISM masked and does not build the email.
 *
 * Ported 2026-09-20 from the old project's `relayProfileSend` against
 * `POST /internal/profile/send` (apps/relay/src/platform/internalRoutes.ts).
 * The old node sent only ids; the handler accepts the masked profile, the
 * submission id and the terms, and node-api's relay.adapter.js already sends
 * them — so this contract carries them too, all optional.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyRelayError, postRelay } from "../relay-http.js";
import { candidateIdOf, jobIdOf, vendorThreadOf } from "../fields.js";

const Input = z
  .object({
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    requirementId: z.string().optional(),
    job_id: z.string().optional(),
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    /** The PRISM submission this profile answers; RELAY puts it in the subject. */
    submissionId: z.string().optional(),
    submission_id: z.string().optional(),
    /** Where it goes: the vendor's thread (reply) or an address. One is required. */
    vendor_thread_id: z.string().optional(),
    relay_thread_id: z.string().optional(),
    vendor_email: z.string().optional(),
    vendor_name: z.string().optional(),
    job_title: z.string().optional(),
    /** What PRISM masked. RELAY reads headline, totalExperience, skills, location, rate, availability, summary. */
    masked_profile: z.record(z.string(), z.unknown()).optional(),
    rate: z.union([z.number(), z.string()]).optional(),
    rate_type: z.string().optional(),
    availability: z.string().optional(),
  })
  .refine((v) => Boolean(candidateIdOf(v)), { message: "needs candidate_id" })
  .refine((v) => Boolean(v.vendor_email || vendorThreadOf(v)), {
    message: "needs a vendor destination — vendor_email or vendor_thread_id",
  });

const Output = z.object({
  status: z.literal("sent"),
  candidateId: z.string(),
  jobId: z.string().nullable(),
  submissionId: z.string().nullable(),
  vendorEmail: z.string(),
  /** The vendor thread the submission sits on — the JD thread, or a new one. */
  threadId: z.string(),
  messageId: z.string(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const profileSend = defineNode({
  key: "relay.profile.send",
  version: "1.0.0",
  module: "relay",
  shareable: true, // RELAY is the communication layer; PRISM's submission ends here

  title: "Send a masked profile to the vendor",
  description:
    "Emails the vendor a candidate's masked profile through RELAY, on the vendor's JD thread when there is one, and announces the submission.",
  tags: ["relay", "profile", "submission", "email", "outbound"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["relay.profile.completed"],
  sideEffect: "external",
  idempotency: {
    strategy: "natural_key",
    keyPaths: [["candidate_id", "candidateId"], ["jobId", "requirement_id", "requirementId", "job_id"], ["vendor_thread_id", "relay_thread_id", "vendor_email"]],
  },

  execution: {
    /** One send through Gmail/SMTP plus a thread lookup. UNVERIFIED — not yet timed here. */
    timeoutMs: 45_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 5_000 },
    classifyError: classifyRelayError,
    locks: [],
  },

  dependencies: ["http"],

  /** The masked profile is the candidate's, redacted or not; not rendered on run detail. */
  persistence: { storeInput: "redact", storeOutput: "full", redactPaths: ["masked_profile"] },

  fixtures: [
    {
      name: "a profile answers the vendor's JD thread",
      input: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f",
        submission_id: "sub-1",
        vendor_thread_id: "vendor-thread-1",
        job_title: "SAP ABAP Developer",
        masked_profile: { headline: "SAP ABAP Consultant", totalExperience: "8 years", skills: ["ABAP", "S/4HANA"] },
        rate: 95,
        rate_type: "C2C",
      },
      config: {},
      expectedOutput: {
        status: "sent",
        candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f",
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        submissionId: "sub-1",
        vendorEmail: "vendor@example.invalid",
        threadId: "vendor-thread-1",
        messageId: "msg-1",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const candidateId = candidateIdOf(input)!;
    const jobId = jobIdOf(input) ?? input.job_id ?? null;
    const submissionId = input.submissionId ?? input.submission_id ?? null;
    const vendorThreadId = vendorThreadOf(input);

    ctx.logger.info("calling Relay profile send", { candidateId, jobId, orgId: ctx.orgId });
    const r = await postRelay(
      "/internal/profile/send",
      {
        jobId: jobId ?? undefined,
        candidate_id: candidateId,
        submissionId: submissionId ?? undefined,
        vendor_thread_id: vendorThreadId,
        vendor_email: input.vendor_email,
        vendor_name: input.vendor_name,
        job_title: input.job_title,
        masked_profile: input.masked_profile,
        rate: input.rate,
        rate_type: input.rate_type,
        availability: input.availability,
        correlation_id: ctx.correlationId ?? undefined,
      },
      { signal: ctx.signal },
    );

    // The stub sends nothing; ids are invented so a local flow can continue.
    const vendorEmail = String(r.vendor_email ?? input.vendor_email ?? (r.stub ? "stub@relay.local" : ""));
    const threadId = String(r.thread_id ?? vendorThreadId ?? (r.stub ? crypto.randomUUID() : ""));
    const messageId = String(r.message_id ?? (r.stub ? crypto.randomUUID() : ""));
    if (!vendorEmail || !threadId || !messageId) {
      throw new Error("relay.profile.send: Relay answered without the thread and message it sent");
    }

    ctx.emit({
      event_type: "relay.profile.completed",
      payload: {
        jobId,
        requirement_id: jobId,
        candidate_id: candidateId,
        submission_id: submissionId,
        vendor_thread_id: threadId,
        vendor_email: vendorEmail,
        message_id: messageId,
      },
    });
    return {
      status: "sent" as const,
      candidateId,
      jobId,
      submissionId,
      vendorEmail,
      threadId,
      messageId,
      stubbed: r.stub === true,
    };
  },
});
