/**
 * RELAY's three contracts, run against a fake RELAY that answers in the
 * shape apps/relay's handlers answer (read from
 * apps/relay/src/platform/internalRoutes.ts on 2026-09-20).
 *
 * Pinned, per node: the path and body sent — including the flow's
 * correlation id, which is how RELAY's later `relay.consent.decided` finds
 * the parked run — the event published, and the output through the
 * contract's own schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunCtx } from "@tekisho/node-contract";
import { consentSend } from "./consent-send.node.js";
import { consentRemind } from "./consent-remind.node.js";
import { profileSend } from "./profile-send.node.js";

const JOB = "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11";
const CAND = "21d2cb25-09be-456f-a4b4-9872e485445f";
const CAND2 = "3a0f2e6b-2c8d-4a15-9b8e-7c6d5e4f3a21";
const CORR = "corr-0000-1111";

type Call = { url: string; path: string; body: any };
const calls: Call[] = [];
const emitted: Array<{ event_type: string; payload: Record<string, unknown> }> = [];

const ctx: NodeRunCtx = {
  orgId: "00000000-0000-0000-0000-000000000001",
  logger: { info: () => {}, error: () => {} },
  emit: (e) => emitted.push(e),
  correlationId: CORR,
};

function fakeRelay(answers: Record<string, { status?: number; json: unknown }>) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    calls.push({ url, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const a = answers[path];
    if (!a) return new Response(JSON.stringify({ error: "no such route" }), { status: 404 });
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  });
}

async function run<C extends { run: (...a: any[]) => Promise<unknown>; config: any; input: any; output: any }>(
  contract: C,
  input: unknown,
  config: unknown = {},
) {
  const out = await contract.run(ctx, contract.input.parse(input), contract.config.parse(config));
  return contract.output.parse(out);
}

beforeEach(() => {
  calls.length = 0;
  emitted.length = 0;
  process.env.ORCH_STUB_RELAY = "off";
  process.env.RELAY_API_URL = "http://relay.test:3005/";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ORCH_STUB_RELAY;
  delete process.env.RELAY_API_URL;
});

describe("relay.consent.send", () => {
  it("asks RELAY to send, with the flow's correlation id, and announces what happened", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRelay({
        "/internal/consent/send": {
          json: {
            status: "sent",
            sent_count: 1,
            thread_ids: ["t-1"],
            consent_threads: [{ candidate_id: CAND, thread_id: "t-1", email: "a@example.invalid" }],
            correlation_id: CORR,
            send_errors: [{ candidate_id: CAND2, email: "x@example.com", reason: "placeholder_email_update_candidate_in_resumes" }],
          },
        },
      }),
    );
    const out = await run(consentSend, {
      requirement_id: JOB,
      top_candidates: [{ id: CAND, score: 90 }, CAND2],
      relay_thread_id: "vendor-thread-1",
      vendor_email: "vendor@example.invalid",
    });
    expect(calls[0]!.url).toBe("http://relay.test:3005/internal/consent/send");
    expect(calls[0]!.body).toEqual({
      jobId: JOB,
      requirement_id: JOB,
      correlation_id: CORR,
      top_candidates: [{ id: CAND, score: 90 }, CAND2],
      vendor_thread_id: "vendor-thread-1",
      vendor_email: "vendor@example.invalid",
    });
    expect(out).toEqual({
      jobId: JOB,
      status: "sent",
      sent_count: 1,
      thread_ids: ["t-1"],
      consent_threads: [{ candidate_id: CAND, thread_id: "t-1", email: "a@example.invalid" }],
      send_errors: [{ candidate_id: CAND2, email: "x@example.com", reason: "placeholder_email_update_candidate_in_resumes" }],
      correlation_id: CORR,
      stubbed: false,
    });
    expect(emitted[0]).toMatchObject({
      event_type: "relay.consent.completed",
      payload: { jobId: JOB, sent_count: 1, thread_ids: ["t-1"], vendor_thread_id: "vendor-thread-1" },
    });
  });

  it("RELAY's own dedupe answer is passed on, not hidden", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRelay({
        "/internal/consent/send": {
          json: { status: "already_sent", sent_count: 0, thread_ids: [], consent_threads: [], correlation_id: null, send_errors: [] },
        },
      }),
    );
    const out = await run(consentSend, { jobId: JOB, candidate_ids: [CAND], vendor_thread_id: "vendor-thread-1" });
    expect(out.status).toBe("already_sent");
    expect(out.correlation_id).toBe(CORR);
    expect(emitted[0]!.payload.status).toBe("already_sent");
  });

  it("needs a job and somebody to ask", () => {
    expect(() => consentSend.input.parse({ top_candidates: [CAND] })).toThrow(/needs jobId/);
    expect(() => consentSend.input.parse({ jobId: JOB })).toThrow(/nobody to ask/);
  });

  it("RELAY's 400 is the input's fault; a refused connection is transient", () => {
    expect(consentSend.execution.classifyError(new Error("Relay /internal/consent/send failed: 400 jobId and top_candidates required"))).toBe("permanent_input");
    expect(consentSend.execution.classifyError(new TypeError("fetch failed"))).toBe("transient");
  });
});

describe("relay.consent.remind", () => {
  it("reminds on the named thread and counts it", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRelay({ "/internal/consent/remind": { json: { status: "reminded", thread_id: "t-1", reminder_count: 1 } } }),
    );
    const out = await run(consentRemind, { thread_id: "t-1", candidate_id: CAND, reminder_count: 0 });
    expect(calls[0]!.body).toEqual({ thread_id: "t-1", candidate_id: CAND, correlation_id: CORR, reminder_count: 1 });
    expect(out).toEqual({ threadId: "t-1", candidateId: CAND, reminderCount: 1, stubbed: false });
    expect(emitted[0]).toEqual({
      event_type: "relay.consent.reminded",
      payload: { thread_id: "t-1", candidate_id: CAND, reminder_count: 1 },
    });
  });

  it("finds the thread by candidate in what the send step returned", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRelay({ "/internal/consent/remind": { json: { status: "reminded", thread_id: "t-2", reminder_count: 2 } } }),
    );
    const out = await run(consentRemind, {
      candidate_id: CAND2,
      consent_threads: [
        { candidate_id: CAND, thread_id: "t-1" },
        { candidate_id: CAND2, thread_id: "t-2" },
      ],
      reminder_count: 1,
    });
    expect(calls[0]!.body.thread_id).toBe("t-2");
    expect(out.reminderCount).toBe(2);
  });

  it("a reminder the provider refused is a failed step, and retried", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRelay({ "/internal/consent/remind": { json: { status: "send_failed", thread_id: "t-1", reminder_count: 1 } } }),
    );
    await expect(run(consentRemind, { thread_id: "t-1" })).rejects.toThrow(/send_failed/);
    expect(emitted).toHaveLength(0);
    expect(consentRemind.execution.classifyError(new Error("Relay /internal/consent/remind failed: 502 send_failed on thread t-1"))).toBe("transient");
  });

  it("needs a thread, one way or another", () => {
    expect(() => consentRemind.input.parse({ candidate_id: CAND })).toThrow(/needs thread_id/);
  });
});

describe("relay.profile.send", () => {
  it("hands RELAY the masked profile and terms, and announces the submission", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRelay({
        "/internal/profile/send": {
          json: { status: "sent", submissionId: "sub-1", candidate_id: CAND, vendor_email: "vendor@example.invalid", thread_id: "vendor-thread-1", message_id: "msg-1" },
        },
      }),
    );
    const out = await run(profileSend, {
      jobId: JOB,
      candidateId: CAND,
      submission_id: "sub-1",
      vendor_thread_id: "vendor-thread-1",
      job_title: "SAP ABAP Developer",
      masked_profile: { headline: "SAP ABAP Consultant", skills: ["ABAP"] },
      rate: 95,
      rate_type: "C2C",
    });
    expect(calls[0]!.body).toEqual({
      jobId: JOB,
      candidate_id: CAND,
      submissionId: "sub-1",
      vendor_thread_id: "vendor-thread-1",
      job_title: "SAP ABAP Developer",
      masked_profile: { headline: "SAP ABAP Consultant", skills: ["ABAP"] },
      rate: 95,
      rate_type: "C2C",
      correlation_id: CORR,
    });
    expect(out).toEqual({
      status: "sent",
      candidateId: CAND,
      jobId: JOB,
      submissionId: "sub-1",
      vendorEmail: "vendor@example.invalid",
      threadId: "vendor-thread-1",
      messageId: "msg-1",
      stubbed: false,
    });
    expect(emitted[0]).toMatchObject({
      event_type: "relay.profile.completed",
      payload: { candidate_id: CAND, submission_id: "sub-1", vendor_thread_id: "vendor-thread-1", message_id: "msg-1" },
    });
  });

  it("a provider failure is RELAY's 500, which is transient", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRelay({ "/internal/profile/send": { status: 500, json: { error: "Failed to dispatch email via provider", status: "send_failed" } } }),
    );
    await expect(run(profileSend, { candidate_id: CAND, vendor_email: "v@example.invalid" })).rejects.toThrow(/failed: 500/);
    expect(profileSend.execution.classifyError(new Error("Relay /internal/profile/send failed: 500 x"))).toBe("transient");
  });

  it("needs a candidate and somewhere to send", () => {
    expect(() => profileSend.input.parse({ vendor_email: "v@example.invalid" })).toThrow(/needs candidate_id/);
    expect(() => profileSend.input.parse({ candidate_id: CAND })).toThrow(/vendor destination/);
  });
});

describe("under the RELAY dev stub", () => {
  it("nothing is sent, ids are invented, and the row says so", async () => {
    process.env.ORCH_STUB_RELAY = "force";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not be called"); }));
    const out = await run(profileSend, { candidate_id: CAND, vendor_email: "v@example.invalid" });
    expect(out.stubbed).toBe(true);
    expect(out.vendorEmail).toBe("v@example.invalid");
  });
});
