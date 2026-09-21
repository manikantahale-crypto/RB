/**
 * relay.consent.remind
 *
 * A candidate was asked and has not answered. RELAY sends a reminder on the
 * same thread (numbered — the second reads differently from the first) and
 * records it on the thread. The consent workflow loops: remind → wait at
 * the gate → the switch reads `reminder_count` and, past `maxReminders`,
 * treats silence as a no.
 *
 * Ported 2026-09-20 from the old project's `relayConsentRemind` against
 * `POST /internal/consent/remind` (apps/relay/src/platform/internalRoutes.ts).
 * The thread may be named directly, or found by candidate in the
 * `consent_threads` the send step returned — mapped in through `inputs`.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import { classifyRelayError, postRelay } from "../relay-http.js";
import { candidateIdOf } from "../fields.js";

const Input = z
  .object({
    /** The candidate's consent thread. */
    thread_id: z.string().optional(),
    relay_thread_id: z.string().optional(),
    candidate_id: z.string().optional(),
    candidateId: z.string().optional(),
    /** What the send step returned; the thread is looked up by candidate. */
    consent_threads: z.array(z.object({ candidate_id: z.string(), thread_id: z.string() })).optional(),
    /** Reminders already sent on this thread; this one is the next. */
    reminder_count: z.number().int().min(0).optional(),
  })
  .refine((v) => Boolean(threadOf(v)), {
    message: "needs thread_id — or a candidate_id with the consent_threads to find it in",
  });

function threadOf(v: {
  thread_id?: string;
  relay_thread_id?: string;
  candidate_id?: string;
  candidateId?: string;
  consent_threads?: Array<{ candidate_id: string; thread_id: string }>;
}): string | undefined {
  if (v.thread_id) return v.thread_id;
  if (v.relay_thread_id) return v.relay_thread_id;
  const cid = candidateIdOf(v);
  return cid ? v.consent_threads?.find((t) => t.candidate_id === cid)?.thread_id : undefined;
}

const Output = z.object({
  threadId: z.string(),
  candidateId: z.string().nullable(),
  /** The number of this reminder, as RELAY recorded it. */
  reminderCount: z.number().int().min(1),
  stubbed: z.boolean(),
});

const Config = z.object({
  agentName: z.string().optional(),
});

export const consentRemind = defineNode({
  key: "relay.consent.remind",
  version: "1.0.0",
  module: "relay",
  shareable: false,

  title: "Remind a candidate who has not answered",
  description:
    "Sends a numbered consent reminder on the candidate's thread through RELAY and announces it, so the workflow can wait again.",
  tags: ["relay", "consent", "email", "outbound", "reminder"],

  input: Input,
  output: Output,
  config: Config,

  emits: ["relay.consent.reminded"],
  sideEffect: "external",
  idempotency: {
    strategy: "natural_key",
    keyPaths: [["thread_id", "relay_thread_id", "candidate_id", "candidateId"], "reminder_count"],
  },

  execution: {
    /** One send through Gmail/SMTP. UNVERIFIED — not yet timed here. */
    timeoutMs: 45_000,
    retry: { limit: 2, backoff: "exponential", baseMs: 5_000 },
    classifyError: classifyRelayError,
    locks: [],
  },

  dependencies: ["http"],
  persistence: { storeInput: "full", storeOutput: "full", redactPaths: [] },

  fixtures: [
    {
      name: "a first reminder on a named thread",
      input: { thread_id: "t-1", candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", reminder_count: 0 },
      config: {},
      expectedOutput: { threadId: "t-1", candidateId: "21d2cb25-09be-456f-a4b4-9872e485445f", reminderCount: 1, stubbed: false },
    },
    {
      name: "the thread found by candidate in what the send step returned",
      input: {
        candidate_id: "3a0f2e6b-2c8d-4a15-9b8e-7c6d5e4f3a21",
        consent_threads: [
          { candidate_id: "21d2cb25-09be-456f-a4b4-9872e485445f", thread_id: "t-1" },
          { candidate_id: "3a0f2e6b-2c8d-4a15-9b8e-7c6d5e4f3a21", thread_id: "t-2" },
        ],
        reminder_count: 1,
      },
      config: {},
      expectedOutput: { threadId: "t-2", candidateId: "3a0f2e6b-2c8d-4a15-9b8e-7c6d5e4f3a21", reminderCount: 2, stubbed: false },
    },
  ],

  run: async (ctx: NodeRunCtx, input) => {
    const threadId = threadOf(input)!;
    const candidateId = candidateIdOf(input) ?? null;
    const reminderCount = Number(input.reminder_count ?? 0) + 1;

    ctx.logger.info("calling Relay consent remind", { threadId, reminderCount, orgId: ctx.orgId });
    const r = await postRelay(
      "/internal/consent/remind",
      {
        thread_id: threadId,
        candidate_id: candidateId ?? undefined,
        correlation_id: ctx.correlationId ?? undefined,
        reminder_count: reminderCount,
      },
      { signal: ctx.signal },
    );

    // RELAY answers 200 with `send_failed` when the mail provider refused.
    // The node boundary is the retry boundary: a reminder that did not go
    // out is a failed step, not a reminded candidate.
    if (r.status === "send_failed") {
      throw new Error(`Relay /internal/consent/remind failed: 502 send_failed on thread ${threadId}`);
    }

    const recorded = Number(r.reminder_count ?? reminderCount);
    ctx.emit({
      event_type: "relay.consent.reminded",
      payload: { thread_id: threadId, candidate_id: candidateId, reminder_count: recorded },
    });
    return { threadId, candidateId, reminderCount: recorded, stubbed: r.stub === true };
  },
});
