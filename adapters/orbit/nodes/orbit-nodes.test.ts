/**
 * ORBIT's five contracts, run against a fake backend that answers in the
 * shape node-api's handlers answer (read from
 * node-api/src/modules/orbit/routes/internal.orbit.routes.js and
 * services/orbitExecute.service.js on 2026-09-20).
 *
 * What is pinned, per node: the path and body sent, the event published and
 * its payload, and the output — parsed by the contract's own schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunCtx } from "@tekisho/node-contract";
import { lifecycleTransition } from "./lifecycle-transition.node.js";
import { placementConfirm } from "./placement-confirm.node.js";
import { revenueArrange } from "./revenue-arrange.node.js";
import { activityNote } from "./activity-note.node.js";
import { orbitRouteDecision } from "./route-decision.node.js";

const CAND = "21d2cb25-09be-456f-a4b4-9872e485445f";
const PLACEMENT = "5d9e0b6a-0d1c-4f4e-9a3b-2c6d7e8f9a01";
const ORG = "00000000-0000-0000-0000-000000000001";

type Call = { path: string; body: unknown };
const calls: Call[] = [];
const emitted: Array<{ event_type: string; payload: Record<string, unknown> }> = [];

const ctx: NodeRunCtx = {
  orgId: ORG,
  logger: { info: () => {}, error: () => {} },
  emit: (e) => emitted.push(e),
};

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

describe("orbit.lifecycle.transition", () => {
  it("asks ORBIT for the move and reports where the person ended up", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        [`/internal/orbit/candidates/${CAND}/lifecycle/transition`]: {
          json: {
            state: { candidate_id: CAND, state: "PLACED", previous_state: "BENCH" },
            valid_transitions: [],
            all_statuses: [],
          },
        },
      }),
    );
    const out = await run(lifecycleTransition, { candidate_id: CAND, to_state: "placed", note: "offer accepted" });
    expect(calls[0]!.body).toEqual({
      to_state: "PLACED",
      note: "offer accepted",
      context: null,
      organization_id: ORG,
      transitioned_by: null,
    });
    expect(out).toEqual({ candidateId: CAND, fromState: "BENCH", toState: "PLACED", branch_key: "placed", stubbed: false });
    expect(emitted[0]).toMatchObject({
      event_type: "orbit.lifecycle.transitioned",
      payload: { candidate_id: CAND, from_state: "BENCH", to_state: "PLACED" },
    });
  });

  it("anything but PLACED is the active path", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        [`/internal/orbit/candidates/${CAND}/lifecycle/transition`]: {
          json: { state: { state: "NOTICE", previous_state: "AVAILABLE" } },
        },
      }),
    );
    const out = await run(lifecycleTransition, { candidateId: CAND, toState: "NOTICE" });
    expect(out.branch_key).toBe("active");
  });

  it("ORBIT refusing the move (400) is the input's fault", () => {
    expect(
      lifecycleTransition.execution.classifyError(new Error("Orbit /x failed: 400 Invalid status: FOO")),
    ).toBe("permanent_input");
  });

  it("needs a person and a state", () => {
    expect(() => lifecycleTransition.input.parse({ to_state: "BENCH" })).toThrow(/needs candidate_id/);
    expect(() => lifecycleTransition.input.parse({ candidate_id: CAND })).toThrow(/needs to_state/);
  });
});

describe("orbit.placement.confirm", () => {
  it("records the placement with its rates and announces it", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        "/internal/orbit/placements": {
          status: 201,
          json: { placement: { id: PLACEMENT, candidate_id: CAND, client_name: "Acme Corp", status: "ACTIVE" } },
        },
      }),
    );
    const out = await run(placementConfirm, {
      candidate_id: CAND,
      client_name: "Acme Corp",
      start_date: "2026-10-01",
      confirmed_bill_rate: 95,
      confirmed_pay_rate: 70,
    });
    expect(calls[0]!.body).toEqual({
      candidate_id: CAND,
      requirement_id: null,
      client_name: "Acme Corp",
      start_date: "2026-10-01",
      end_date: null,
      confirmed_bill_rate: 95,
      confirmed_pay_rate: 70,
      employment_model: "C2C",
      work_mode: "ONSITE",
      location: null,
      notes: null,
      organization_id: ORG,
    });
    expect(out).toEqual({ placementId: PLACEMENT, candidateId: CAND, clientName: "Acme Corp", branch_key: "placed", stubbed: false });
    expect(emitted[0]).toMatchObject({
      event_type: "orbit.placement.confirmed",
      payload: { candidate_id: CAND, placement_id: PLACEMENT, client_name: "Acme Corp" },
    });
  });
});

describe("orbit.revenue.arrange", () => {
  it("attaches the arrangement to the placement's own path", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        [`/internal/orbit/placements/${PLACEMENT}/revenue`]: {
          json: { arrangement: { placement_id: PLACEMENT, arrangement_type: "MARKUP", value: 25 }, summary: {} },
        },
      }),
    );
    const out = await run(revenueArrange, { placement_id: PLACEMENT, arrangement_type: "markup", value: 25 });
    expect(calls[0]!.path).toBe(`/internal/orbit/placements/${PLACEMENT}/revenue`);
    expect(calls[0]!.body).toEqual({
      arrangement_type: "MARKUP",
      value: 25,
      notes: null,
      custom_formula: null,
      organization_id: ORG,
    });
    expect(out).toEqual({ placementId: PLACEMENT, arrangementType: "MARKUP", value: 25, stubbed: false });
    expect(emitted[0]).toMatchObject({ event_type: "orbit.revenue.arranged", payload: { placement_id: PLACEMENT, value: 25 } });
  });
});

describe("orbit.activity.note", () => {
  it("writes the line and announces it", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBackend({
        [`/internal/orbit/candidates/${CAND}/activities`]: {
          status: 201,
          json: { id: "act-1", candidate_id: CAND, activity_type: "NOTE", summary: "Spoke on the phone." },
        },
      }),
    );
    const out = await run(activityNote, { candidate_id: CAND, note: "  Spoke on the phone. " });
    expect(calls[0]!.body).toEqual({ summary: "Spoke on the phone.", payload: {} });
    expect(out).toEqual({ candidateId: CAND, summary: "Spoke on the phone.", activityType: "NOTE", stubbed: false });
    expect(emitted[0]).toMatchObject({ event_type: "orbit.activity.noted", payload: { candidate_id: CAND } });
  });
});

describe("orbit.route.decision", () => {
  it("PLACED goes to the placement path, silently", async () => {
    const out = await run(orbitRouteDecision, { to_state: "PLACED" });
    expect(out).toEqual({ branch_key: "placed", toState: "PLACED" });
    expect(emitted).toHaveLength(0);
  });

  it("HOLD and IGNORE announce the hold", async () => {
    const out = await run(orbitRouteDecision, { to_state: "ignore", candidate_id: CAND, note: "visa pending" });
    expect(out).toEqual({ branch_key: "hold", toState: "IGNORE" });
    expect(emitted[0]).toEqual({
      event_type: "orbit.bench.hold",
      payload: { candidate_id: CAND, to_state: "IGNORE", reason: "visa pending" },
    });
  });

  it("honours the branch an earlier step decided, mapped in through `inputs`", async () => {
    const out = await run(orbitRouteDecision, { branch_key: "placed" });
    expect(out.branch_key).toBe("placed");
  });
});
