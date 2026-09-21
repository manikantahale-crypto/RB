/**
 * PRISM's seven contracts, run against a fake node-api that answers in the
 * shape the PRISM internal handlers answer
 * (node-api/src/modules/prism/routes/internal.prism.routes.js, 2026-09-20:
 * the four inbound callbacks, and the three outbound endpoints added for
 * these nodes).
 *
 * Pinned, per node: the path and body sent, the event published, and the
 * output through the contract's own schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunCtx } from "@tekisho/node-contract";
import { submissionOpen } from "./submission-open.node.js";
import { consentRecord } from "./consent-record.node.js";
import { profileMask } from "./profile-mask.node.js";
import { vendorRecord } from "./vendor-record.node.js";
import { submissionTransition } from "./submission-transition.node.js";
import { rtrRecord } from "./rtr-record.node.js";
import { confirmationRecord } from "./confirmation-record.node.js";

const JOB = "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11";
const CAND = "21d2cb25-09be-456f-a4b4-9872e485445f";
const SUB = "6e0b1c2d-3f4a-4b5c-8d6e-7f8a9b0c1d2e";

type Call = { path: string; body: any };
const calls: Call[] = [];
const emitted: Array<{ event_type: string; payload: Record<string, unknown> }> = [];

const ctx: NodeRunCtx = {
  orgId: "00000000-0000-0000-0000-000000000001",
  logger: { info: () => {}, error: () => {} },
  emit: (e) => emitted.push(e),
};

function fakePrism(answers: Record<string, { status?: number; json: unknown }>) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
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
  process.env.ORCH_STUB_SYNTRA = "off";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ORCH_STUB_SYNTRA;
});

describe("prism.submission.open", () => {
  it("opens a DRAFT for the pair, acting as the requirement's owner", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        "/internal/prism/submissions": {
          status: 201,
          json: { status: "created", submission: { id: SUB, status: "DRAFT", candidate_id: CAND, job_id: JOB, resume_id: "r-1" }, actor_source: "requirement_owner" },
        },
      }),
    );
    const out = await run(submissionOpen, { candidate_id: CAND, requirement_id: JOB, match_id: "m-1" });
    expect(calls[0]!.body).toEqual({ candidateId: CAND, jobId: JOB, matchId: "m-1" });
    expect(out).toEqual({ submissionId: SUB, candidateId: CAND, jobId: JOB, status: "DRAFT", created: true, actorSource: "requirement_owner", stubbed: false });
    expect(emitted[0]).toMatchObject({ event_type: "prism.submission.opened", payload: { submission_id: SUB, candidate_id: CAND, created: true } });
  });

  it("an existing active submission is returned, not duplicated", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        "/internal/prism/submissions": {
          json: { status: "exists", submission: { id: SUB, status: "PENDING_CONSENT", candidate_id: CAND, job_id: JOB }, actor_source: "payload" },
        },
      }),
    );
    const out = await run(submissionOpen, { candidateId: CAND, jobId: JOB, actor_id: "user-1" });
    expect(calls[0]!.body.actorId).toBe("user-1");
    expect(out).toMatchObject({ submissionId: SUB, status: "PENDING_CONSENT", created: false, actorSource: "payload" });
  });

  it("no owner to act as is the input's fault", () => {
    expect(submissionOpen.execution.classifyError(new Error("Prism /internal/prism/submissions failed: 422 No actor"))).toBe("permanent_input");
  });
});

describe("prism.consent.record", () => {
  it("RELAY's 'approved' becomes ACCEPTED and validates the candidate", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        "/internal/prism/consent/response": {
          json: { status: "success", submissionId: SUB, newStatus: "CANDIDATE_VALIDATED", candidateValidationResults: null },
        },
      }),
    );
    const out = await run(consentRecord, { candidate_id: CAND, jobId: JOB, decision: "approved", relay_thread_id: "t-1", body_snippet: "Yes, go ahead" });
    expect(calls[0]!.body).toEqual({ candidateId: CAND, jobId: JOB, response: "ACCEPTED", notes: "Yes, go ahead", threadId: "t-1" });
    expect(out).toEqual({ status: "success", submissionId: SUB, response: "ACCEPTED", newStatus: "CANDIDATE_VALIDATED", stubbed: false });
    expect(emitted[0]).toMatchObject({ event_type: "prism.consent.recorded", payload: { submission_id: SUB, response: "ACCEPTED", new_status: "CANDIDATE_VALIDATED" } });
  });

  it("an answer PRISM cannot place is reported as such, and announced as such", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        "/internal/prism/consent/response": { json: { status: "ambiguous_or_not_found", message: "No matching consent submission for this candidate." } },
      }),
    );
    const out = await run(consentRecord, { candidate_id: CAND, approved: false });
    expect(calls[0]!.body.response).toBe("REJECTED");
    expect(out).toEqual({ status: "ambiguous_or_not_found", submissionId: null, response: "REJECTED", newStatus: null, stubbed: false });
    expect(emitted[0]!.payload.status).toBe("ambiguous_or_not_found");
  });

  it("needs an answer and someone to find", () => {
    expect(() => consentRecord.input.parse({ candidate_id: CAND })).toThrow(/needs the candidate's answer/);
    expect(() => consentRecord.input.parse({ decision: "yes" })).toThrow(/needs a submission_id or a candidate_id/);
  });
});

describe("prism.profile.mask", () => {
  it("masks and hands back the profile RELAY will send", async () => {
    const masked = { maskedCandidateId: "CAND-21D2CB25", headline: "SAP ABAP Consultant", skills: ["ABAP"] };
    vi.stubGlobal(
      "fetch",
      fakePrism({
        [`/internal/prism/submissions/${SUB}/mask`]: { json: { status: "success", submissionId: SUB, newStatus: "MASKED", maskedProfile: masked, actor_source: "submission_owner" } },
      }),
    );
    const out = await run(profileMask, { submission_id: SUB });
    expect(calls[0]!.path).toBe(`/internal/prism/submissions/${SUB}/mask`);
    expect(calls[0]!.body).toEqual({});
    expect(out).toEqual({ submissionId: SUB, status: "MASKED", maskedProfile: masked, stubbed: false });
    expect(emitted[0]).toMatchObject({ event_type: "prism.profile.masked", payload: { submission_id: SUB, masked_profile: masked } });
  });

  it("a recruiter-edited profile is sent instead of PRISM's", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        [`/internal/prism/submissions/${SUB}/mask`]: { json: { status: "success", newStatus: "MASKED", maskedProfile: { headline: "Edited" } } },
      }),
    );
    await run(profileMask, { submissionId: SUB, masked_profile: { headline: "Edited" } });
    expect(calls[0]!.body).toEqual({ maskedProfile: { headline: "Edited" } });
  });

  it("a move the matrix refuses is the input's fault", () => {
    expect(profileMask.execution.classifyError(new Error("Prism /x failed: 400 Invalid transition from DRAFT to MASKED"))).toBe("permanent_input");
  });
});

describe("prism.vendor.record", () => {
  it("the vendor's yes is recorded", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({ "/internal/prism/vendor/response": { json: { status: "success", submissionId: SUB, newStatus: "VENDOR_ACCEPTED" } } }),
    );
    const out = await run(vendorRecord, { submission_id: SUB, response: "yes", sender_email: "vendor@example.invalid" });
    expect(calls[0]!.body).toEqual({ submissionId: SUB, senderEmail: "vendor@example.invalid", response: "ACCEPTED" });
    expect(out).toEqual({ status: "success", submissionId: SUB, response: "ACCEPTED", newStatus: "VENDOR_ACCEPTED", stubbed: false });
    expect(emitted[0]!.event_type).toBe("prism.vendor.recorded");
  });
});

describe("prism.submission.transition", () => {
  it("moves to the status the step is set to", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        [`/internal/prism/submissions/${SUB}/transition`]: { json: { status: "success", submissionId: SUB, previousStatus: "MASKED", newStatus: "VENDOR_SUBMITTED" } },
      }),
    );
    const out = await run(submissionTransition, { submission_id: SUB }, { targetStatus: "VENDOR_SUBMITTED" });
    expect(calls[0]!.body).toEqual({ targetStatus: "VENDOR_SUBMITTED", metadata: {} });
    expect(out).toEqual({ submissionId: SUB, status: "success", previousStatus: "MASKED", newStatus: "VENDOR_SUBMITTED", stubbed: false });
    expect(emitted[0]).toMatchObject({ event_type: "prism.submission.transitioned", payload: { previous_status: "MASKED", new_status: "VENDOR_SUBMITTED" } });
  });

  it("the event's target wins over the step's, and carries what the move needs", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        [`/internal/prism/submissions/${SUB}/transition`]: { json: { status: "success", previousStatus: "AVAILABILITY_CONFIRMED", newStatus: "RATE_CONFIRMED" } },
      }),
    );
    await run(submissionTransition, { submissionId: SUB, target_status: "RATE_CONFIRMED", metadata: { rate: 95, rateType: "HOURLY" } }, { targetStatus: "WITHDRAWN" });
    expect(calls[0]!.body).toEqual({ targetStatus: "RATE_CONFIRMED", metadata: { rate: 95, rateType: "HOURLY" } });
  });

  it("already there is not an error", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        [`/internal/prism/submissions/${SUB}/transition`]: { json: { status: "already_processed", submissionId: SUB, previousStatus: "MASKED", newStatus: "MASKED" } },
      }),
    );
    const out = await run(submissionTransition, { submission_id: SUB }, { targetStatus: "MASKED" });
    expect(out.status).toBe("already_processed");
  });

  it("no target anywhere is a refused run", async () => {
    vi.stubGlobal("fetch", fakePrism({}));
    await expect(run(submissionTransition, { submission_id: SUB })).rejects.toThrow(/no target status/);
    expect(calls).toHaveLength(0);
  });

  it("a status PRISM does not have is refused before the call", () => {
    expect(() => submissionTransition.config.parse({ targetStatus: "SENT" })).toThrow();
  });
});

describe("prism.rtr.record", () => {
  it("a signed RTR confirms the submission", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({ "/internal/prism/rtr/response": { json: { status: "success", submissionId: SUB, rtrStatus: "SIGNED", newStatus: "RTR_CONFIRMED" } } }),
    );
    const out = await run(rtrRecord, { submission_id: SUB, response: "signed", message_id: "m-9" });
    expect(calls[0]!.body).toEqual({ submissionId: SUB, response: "SIGNED", messageId: "m-9" });
    expect(out).toEqual({ status: "success", submissionId: SUB, rtrStatus: "SIGNED", newStatus: "RTR_CONFIRMED", stubbed: false });
    expect(emitted[0]).toMatchObject({ event_type: "prism.rtr.recorded", payload: { rtr_status: "SIGNED", new_status: "RTR_CONFIRMED" } });
  });

  it("found by job and sender when there is no id", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({ "/internal/prism/rtr/response": { json: { status: "success", submissionId: SUB, rtrStatus: "DECLINED", newStatus: "REJECTED" } } }),
    );
    const out = await run(rtrRecord, { jobId: JOB, sender_email: "c@example.invalid", signed: false });
    expect(calls[0]!.body).toMatchObject({ jobId: JOB, senderEmail: "c@example.invalid", response: "DECLINED" });
    expect(out.rtrStatus).toBe("DECLINED");
    expect(() => rtrRecord.input.parse({ jobId: JOB, signed: true })).toThrow(/sender's email/);
  });
});

describe("prism.confirmation.record", () => {
  it("the consultant's confirmation, party from the event", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({
        "/internal/prism/confirmation/response": { json: { status: "success", submissionId: SUB, party: "CONSULTANT", confirmationStatus: "CONFIRMED", newStatus: "AVAILABILITY_CONFIRMED" } },
      }),
    );
    const out = await run(confirmationRecord, { submission_id: SUB, party: "consultant", response: "yes" });
    expect(calls[0]!.body).toEqual({ submissionId: SUB, party: "CONSULTANT", response: "CONFIRMED" });
    expect(out).toEqual({ status: "success", submissionId: SUB, party: "CONSULTANT", confirmationStatus: "CONFIRMED", newStatus: "AVAILABILITY_CONFIRMED", stubbed: false });
    expect(emitted[0]!.event_type).toBe("prism.confirmation.recorded");
  });

  it("the party set on the step, and no party anywhere is a refused run", async () => {
    vi.stubGlobal(
      "fetch",
      fakePrism({ "/internal/prism/confirmation/response": { json: { status: "success", submissionId: SUB, newStatus: "REJECTED" } } }),
    );
    await run(confirmationRecord, { submissionId: SUB, decision: "no" }, { party: "VENDOR" });
    expect(calls[0]!.body).toMatchObject({ party: "VENDOR", response: "DECLINED" });
    await expect(run(confirmationRecord, { submissionId: SUB, decision: "no" })).rejects.toThrow(/no party/);
  });
});
