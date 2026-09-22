/**
 * relay.consent.send
 *
 * A shortlist is ready and the people on it have to agree before their
 * profile goes anywhere. RELAY writes and sends one consent email per
 * candidate (at most five), opens a thread and a follow-up for each, and
 * hands back which threads it opened and who it could not reach. The
 * workflow then parks at a human gate until `relay.consent.decided` arrives
 * — which RELAY publishes with the correlation id this node hands it, and
 * which is how the parked run is found.
 *
 * Ported 2026-09-20 from the old project's `relayConsentSend`
 * (old_db_repo/packages/orchestrator/src/nodes/relay-actions.ts) against
 * the handler it calls (apps/relay/src/platform/internalRoutes.ts,
 * `POST /internal/consent/send`) — same request, same fields read, same
 * event. RELAY's four business rules (no placeholder email, one consent per
 * candidate per job unless `force`, candidate must be in the recruiter's
 * pool, five at a time) live in RELAY and are reported back in
 * `send_errors`; this node does not second-guess them.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyRelayError, postRelay } from "../relay-http.js";
import { jobIdOf, vendorEmailOf, vendorThreadOf } from "../fields.js";

/** A candidate on the shortlist: an id, or an id with what RELAY can use. */
const Candidate = z.union([
  z.string().min(1),
  z.object({
    id: z.string().min(1),
    email: z.string().optional(),
    name: z.string().optional(),
    score: z.number().optional(),
    submissionId: z.string().optional(),
    submission_id: z.string().optional(),
  }),
]);

const Input = z
  .object({
    jobId: z.string().optional(),
    requirement_id: z.string().optional(),
    requirementId: z.string().optional(),
    top_candidates: z.array(Candidate).optional(),
    /** What the old project's events called the same list. */
    candidate_ids: z.array(z.string()).optional(),
    /** The vendor's JD thread, so RELAY can mark the shortlist consent-sent. */
    vendor_thread_id: z.string().optional(),
    relay_thread_id: z.string().optional(),
    vendor_email: z.string().optional(),
    /** What `relay.profile.send` returns it as. */
    vendorEmail: z.string().optional(),
    /** One submission for all, when the shortlist is one PRISM submission. */
    submissionId: z.string().optional(),
    submission_id: z.string().optional(),
    /** Override RELAY's canonical consent email. Both or neither. */
    subject: z.string().optional(),
    body: z.string().optional(),
    /** Send again even where a consent thread already exists for this job. */
    force: z.boolean().optional(),
  })
  .refine((v) => Boolean(jobIdOf(v)), { message: "needs jobId" })
  .refine((v) => (v.top_candidates?.length ?? 0) + (v.candidate_ids?.length ?? 0) > 0, {
    message: "needs top_candidates — nobody to ask",
  });

const ConsentThread = z.object({
  candidate_id: z.string(),
  thread_id: z.string(),
  email: z.string().optional(),
  submission_id: z.string().optional(),
});

const SendError = z.object({
  candidate_id: z.string(),
  email: z.string(),
  reason: z.string(),
});

const Output = z.object({
  jobId: z.string(),
  /** sent | no_recipients | already_sent — RELAY's word. */
  status: z.string(),
  sent_count: z.number().int().min(0),
  thread_ids: z.array(z.string()),
  consent_threads: z.array(ConsentThread),
  send_errors: z.array(SendError),
  /** What RELAY stored on the threads — this flow's, or one it minted. */
  correlation_id: z.string().nullable(),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const consentSend = defineNode({
  key: "relay.consent.send",
  version: "1.0.0",
  module: "relay",
  shareable: true, // RELAY is the communication layer; SYNTRA's shortlist asks it to send

  title: "Ask the shortlisted candidates for consent",
  description:
    "Sends each shortlisted candidate a consent email through RELAY, opens a thread and a follow-up per candidate, and announces what was sent and who could not be reached.",
  tags: ["relay", "consent", "email", "outbound"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["relay.consent.completed"],
  sideEffect: "external",
  idempotency: {
    strategy: "natural_key",
    keyPaths: [["jobId", "requirement_id", "requirementId"], ["vendor_thread_id", "relay_thread_id"]],
  },

  execution: {
    /** Up to five sends through Gmail/SMTP plus a job lookup. UNVERIFIED — not yet timed here. */
    timeoutMs: 90_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 5_000 },
    classifyError: classifyRelayError,
    locks: [],
  },

  dependencies: ["http"],

  /** The email body override is the recruiter's words to a candidate; not rendered on run detail. */
  persistence: { storeInput: "redact", storeOutput: "full", redactPaths: ["body"] },

  fixtures: [
    {
      name: "three candidates asked, one unreachable",
      input: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        top_candidates: [
          { id: "21d2cb25-09be-456f-a4b4-9872e485445f", score: 90 },
          "3a0f2e6b-2c8d-4a15-9b8e-7c6d5e4f3a21",
          { id: "4b1a3f7c-3d9e-4b26-8c9f-8d7e6f5a4b32", email: "x@example.com" },
        ],
        vendor_thread_id: "vendor-thread-1",
        vendor_email: "vendor@example.invalid",
      },
      config: {},
      expectedOutput: {
        jobId: "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11",
        status: "sent",
        sent_count: 2,
        thread_ids: ["t-1", "t-2"],
        consent_threads: [
          { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", thread_id: "t-1", email: "a@example.invalid" },
          { candidate_id: "3a0f2e6b-2c8d-4a15-9b8e-7c6d5e4f3a21", thread_id: "t-2", email: "b@example.invalid" },
        ],
        send_errors: [
          { candidate_id: "4b1a3f7c-3d9e-4b26-8c9f-8d7e6f5a4b32", email: "x@example.com", reason: "placeholder_email_update_candidate_in_resumes" },
        ],
        correlation_id: "corr-1",
        stubbed: false,
      },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const jobId = jobIdOf(input)!;
    const topCandidates = input.top_candidates ?? input.candidate_ids ?? [];
    const vendorThreadId = vendorThreadOf(input);
    const submissionId = input.submissionId ?? input.submission_id;

    ctx.logger.info("calling Relay consent send", {
      jobId,
      candidates: topCandidates.length,
      orgId: ctx.orgId,
    });
    const r = await postRelay(
      "/internal/consent/send",
      {
        jobId,
        requirement_id: jobId,
        // The flow's id, so the candidate's answer can find this run.
        correlation_id: ctx.correlationId ?? undefined,
        top_candidates: topCandidates,
        vendor_thread_id: vendorThreadId,
        vendor_email: vendorEmailOf(input),
        ...(submissionId ? { submissionId } : {}),
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.body ? { body: input.body } : {}),
        ...(input.force ? { force: true } : {}),
      },
      { signal: ctx.signal },
    );

    const out = {
      jobId,
      status: String(r.status ?? "sent"),
      sent_count: Number(r.sent_count ?? 0),
      thread_ids: (r.thread_ids ?? []) as string[],
      consent_threads: (r.consent_threads ?? []) as z.infer<typeof ConsentThread>[],
      send_errors: (r.send_errors ?? []) as z.infer<typeof SendError>[],
      correlation_id: (r.correlation_id ?? ctx.correlationId ?? null) as string | null,
      stubbed: r.stub === true,
    };

    // Announced whatever the count, as the old project did: a shortlist with
    // nobody reachable is an outcome the recruiter has to see, not a silence.
    ctx.emit({
      event_type: "relay.consent.completed",
      payload: {
        jobId,
        requirement_id: jobId,
        status: out.status,
        sent_count: out.sent_count,
        thread_ids: out.thread_ids,
        consent_threads: out.consent_threads,
        send_errors: out.send_errors,
        vendor_thread_id: vendorThreadId ?? null,
        vendor_email: vendorEmailOf(input) ?? null,
        correlation_id: out.correlation_id,
      },
    });
    return out;
  },
});
