/**
 * ASTRA's six contracts, run against a fake backend that answers in the
 * shape node-api's handlers answer (read from
 * node-api/src/modules/astra/routes/internal.astra.routes.js and
 * controllers/jobBoards.controller.js on 2026-09-20).
 *
 * What is pinned, per node: the path and body sent, the event published and
 * its payload, and the output — parsed by the contract's own schema. The
 * fixture runner cannot run these (they declare `http`), so this is the
 * only place the `run` bodies are exercised in CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunCtx } from "@tekisho/node-contract";
import { requirementIntake } from "./requirement-intake.node.js";
import { requirementIngest } from "./requirement-ingest.node.js";
import { jobboardFetch } from "./jobboard-fetch.node.js";
import { requirementQuality } from "./requirement-quality.node.js";
import { requirementNormalize } from "./requirement-normalize.node.js";
import { routeDecision } from "./route-decision.node.js";

const JOB = "8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11";

type Call = { path: string; body: unknown };
const calls: Call[] = [];
const emitted: Array<{ event_type: string; payload: Record<string, unknown> }> = [];

const CORR = "corr-0000-1111";
const ctx: NodeRunCtx = {
  orgId: "00000000-0000-0000-0000-000000000001",
  logger: { info: () => {}, error: () => {} },
  emit: (e) => emitted.push(e),
  correlationId: CORR,
};

/** One answer per path, in the handler's shape. */
function fakeBackend(answers: Record<string, { status?: number; json: unknown }>) {
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

describe("astra.requirement.intake", () => {
  it("posts the email with the flow's id; the SERVICE announces the requirement, not this node", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        "/internal/astra/intake/email": {
          status: 201,
          json: { created: true, jobId: JOB, job: { id: JOB, title: "Java Developer (parsed)" } },
        },
      }),
    );
    const out = await run(requirementIntake, {
      subject: "Java Developer — Austin",
      from: "vendor@example.invalid",
      body: "Client needs a Java developer.",
    });
    expect(calls[0]).toEqual({
      path: "/internal/astra/intake/email",
      body: { subject: "Java Developer — Austin", body: "Client needs a Java developer.", from: "vendor@example.invalid", correlation_id: CORR },
    });
    expect(out).toMatchObject({ jobId: JOB, title: "Java Developer (parsed)", channel_type: "EMAIL", stubbed: false });
    // astra.service.js writes astra.requirement.received in the row's own
    // transaction; a second copy from here would start a second run.
    expect(emitted).toHaveLength(0);
    expect(requirementIntake.emits).toEqual([]);
  });

  it("refuses an email with no body before calling anyone", () => {
    expect(() => requirementIntake.input.parse({ subject: "x" })).toThrow(/needs the email body/);
  });

  it("a 4xx from ASTRA is the input's fault, a 5xx is transient", () => {
    const classify = requirementIntake.execution.classifyError;
    expect(classify(new Error("Astra /internal/astra/intake/email failed: 422 bad"))).toBe("permanent_input");
    expect(classify(new Error("Astra /internal/astra/intake/email failed: 503 down"))).toBe("transient");
    expect(classify(new Error("astra.requirement.intake: Astra returned no jobId"))).toBe("permanent_input");
  });
});

describe("astra.requirement.ingest", () => {
  it("posts the text with its channel and the flow's id, and announces nothing itself", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        "/internal/astra/requirements/ingest": {
          status: 201,
          json: { status: "created", jobId: JOB, requirement_id: JOB, title: "Data Engineer" },
        },
      }),
    );
    const out = await run(requirementIngest, { title: "Data Engineer", raw_text: "Snowflake, dbt." });
    expect(calls[0]!.body).toEqual({
      title: "Data Engineer",
      raw_text: "Snowflake, dbt.",
      channel_type: "API",
      source: "orch",
      correlation_id: CORR,
    });
    expect(out).toEqual({ jobId: JOB, channel_type: "API", duplicate: false, stubbed: false });
    expect(emitted).toHaveLength(0);
  });
});

describe("astra.jobboard.fetch", () => {
  it("reads the endpoint's real shape and counts the NEW requirements; the service announced each", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        "/internal/astra/jobboards/fetch": {
          json: {
            status: "success",
            data: {
              source: "jsearch",
              fetched: 4,
              created: 2,
              duplicates: 1,
              items: [
                { id: "a1", title: "ABAP 1", status: "New" },
                { id: "a2", title: "ABAP 2", status: "Duplicate" },
                { id: "a3", title: "ABAP 3", status: "New" },
                { id: null, title: "ABAP 4", status: "Failed" },
              ],
            },
          },
        },
      }),
    );
    const out = await run(jobboardFetch, { source: "jsearch", keyword: "SAP ABAP", location: "Dallas" });
    expect(calls[0]!.body).toMatchObject({ source: "jsearch", keyword: "SAP ABAP", location: "Dallas", correlation_id: CORR });
    expect(out).toEqual({ count: 2, firstJobId: "a1", source: "jsearch", stubbed: false });
    expect(emitted).toHaveLength(0);
  });

  it("takes the board from config when the event does not say", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        "/internal/astra/jobboards/fetch": {
          json: { status: "success", data: { items: [{ id: "b1", status: "New" }] } },
        },
      }),
    );
    await run(jobboardFetch, { keyword: "React" }, { source: "adzuna" });
    expect(calls[0]!.body).toMatchObject({ source: "adzuna" });
  });

  it("nothing ingested is a failure, said as the input's", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        "/internal/astra/jobboards/fetch": { json: { status: "success", data: { items: [] } } },
      }),
    );
    await expect(run(jobboardFetch, { source: "jsearch", keyword: "x" })).rejects.toThrow(/no jobs created/);
    expect(jobboardFetch.execution.classifyError(new Error("astra.jobboard.fetch: no jobs created"))).toBe(
      "permanent_input",
    );
  });
});

describe("astra.requirement.quality", () => {
  it("passes the score through and announces it", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        "/internal/astra/requirements/quality": {
          json: { status: "scored", jobId: JOB, is_actionable: true, confidence_score: 0.75, validation_details: { ok: true } },
        },
      }),
    );
    const out = await run(requirementQuality, { jobId: JOB, title: "Java", required_skills: ["java"] });
    expect(calls[0]!.body).toMatchObject({ jobId: JOB, requirement_id: JOB, title: "Java", required_skills: ["java"] });
    expect(out).toEqual({ jobId: JOB, is_actionable: true, confidence_score: 0.75, validation_details: { ok: true }, stubbed: false });
    expect(emitted[0]).toMatchObject({
      event_type: "astra.requirement.scored",
      payload: { jobId: JOB, is_actionable: true, confidence_score: 0.75 },
    });
  });
});

describe("astra.requirement.normalize", () => {
  it("posts to the requirement's own path, with the prompt when configured", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        [`/internal/astra/requirements/${JOB}/normalize`]: {
          json: { status: "normalized", jobId: JOB, is_actionable: true, confidence_score: 0.82, title: "Java Developer" },
        },
      }),
    );
    const out = await run(requirementNormalize, { requirement_id: JOB }, { prompt: "  prefer US locations " });
    expect(calls[0]!.path).toBe(`/internal/astra/requirements/${JOB}/normalize`);
    expect(calls[0]!.body).toMatchObject({ jobId: JOB, prompt: "prefer US locations" });
    // The handler sends no parser_version; the engine's fallback name is kept.
    expect(out).toEqual({
      jobId: JOB,
      status: "normalized",
      is_actionable: true,
      confidence_score: 0.82,
      parser_version: "astra-intelligence-v1",
      stubbed: false,
    });
    expect(emitted[0]).toMatchObject({ event_type: "astra.requirement.normalized", payload: { jobId: JOB } });
  });

  it("refuses a run with no requirement id", () => {
    expect(() => requirementNormalize.input.parse({ raw_text: "x" })).toThrow(/needs jobId/);
  });
});

describe("astra.route.decision", () => {
  it("hands an actionable requirement to SYNTRA under the configured event", async () => {
    const out = await run(
      routeDecision,
      { jobId: JOB, is_actionable: true, confidence_score: 0.82, event_id: "ev-1" },
      { minConfidence: 0.5 },
    );
    expect(out).toEqual({ branch_key: "pass", jobId: JOB, reason: null });
    expect(emitted[0]).toMatchObject({
      event_type: "syntra.jd.normalized",
      payload: { jobId: JOB, status: "normalized", confidence_score: 0.82, source_event_id: "ev-1" },
    });
  });

  it("rejects below the threshold and says why", async () => {
    const out = await run(routeDecision, { jobId: JOB, is_actionable: true, confidence_score: 0.3 }, { minConfidence: 0.5, onRejected: "astra.custom.rejected" });
    expect(out).toEqual({ branch_key: "reject", jobId: JOB, reason: "confidence_below_min (0.3 < 0.5)" });
    expect(emitted[0]).toMatchObject({ event_type: "astra.custom.rejected", payload: { status: "rejected" } });
  });

  it("declares both events it may publish, from config", () => {
    expect(routeDecision.emits).toEqual([{ fromConfig: "onActionable" }, { fromConfig: "onRejected" }]);
  });
});

describe("under the dev stub", () => {
  it("intake still yields an id, and says it was stubbed", async () => {
    process.env.ORCH_STUB_SYNTRA = "force";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not be called"); }));
    const out = await run(requirementIntake, { body: "text" });
    expect(out.stubbed).toBe(true);
    expect(out.jobId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
