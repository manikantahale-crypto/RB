import { describe, expect, it } from "vitest";
import { parseBinding } from "./binding.js";

const valid = {
  event_type: "astra.requirement.published",
  routing_group: "requirement.post-intake",
  mode: "exclusive",
  priority: 10,
  target_kind: "graph",
  workflow_key: "syntra.jd.workflow",
  module_queue: "module.syntra.jd",
  status: "ACTIVE",
  owner_module: "syntra",
};

const parse = (over: Record<string, unknown> = {}) =>
  parseBinding({ ...valid, ...over });

/** Narrow to a graph target. The union means you cannot read workflow_key
 *  without asking first — which is the schema doing its job. */
const asGraph = (b: ReturnType<typeof parse>) => {
  if (b.target_kind !== "graph") throw new Error("expected a graph target");
  return b;
};

describe("a valid binding", () => {
  it("is accepted", () => {
    expect(asGraph(parse()).workflow_key).toBe("syntra.jd.workflow");
  });

  it("defaults conditions, org scope and status fields sensibly", () => {
    const b = parse();
    expect(b.conditions).toEqual({ requires_entitlement: [] });
    expect(b.org_id).toBeNull();
  });
});

describe("a binding never carries a version", () => {
  it("rejects a workflow key with a version pinned into it", () => {
    expect(() => parse({ workflow_key: "syntra.jd.workflow@3" })).toThrow(
      /a binding never carries a version/,
    );
  });

  it("silently drops an unknown `version` field rather than honouring it", () => {
    const b = parse({ version: 3 } as Record<string, unknown>);
    expect(b).not.toHaveProperty("version");
  });
});

describe("conditions cannot express business logic", () => {
  it("rejects a threshold", () => {
    expect(() =>
      parse({ conditions: { requires_entitlement: [], minScore: 0.8 } }),
    ).toThrow(/BINDING_INVALID/);
  });

  it("rejects payload field inspection", () => {
    expect(() =>
      parse({
        conditions: { requires_entitlement: [], where: "payload.priority = HOT" },
      }),
    ).toThrow(/BINDING_INVALID/);
  });

  it("accepts entitlements, which is the whole allowed vocabulary", () => {
    expect(
      parse({ conditions: { requires_entitlement: ["SYNTRA"] } }).conditions
        .requires_entitlement,
    ).toEqual(["SYNTRA"]);
  });
});

describe("target kind decides which fields exist", () => {
  it("requires a workflow key and queue for a graph target", () => {
    expect(() =>
      parseBinding({ ...valid, workflow_key: undefined }),
    ).toThrow(/BINDING_INVALID/);
  });

  it("does not allow a terminal route to name a workflow", () => {
    const b = parseBinding({
      ...valid,
      target_kind: "terminal",
      workflow_key: "syntra.jd.workflow",
    });
    expect(b).not.toHaveProperty("workflow_key");
  });

  it("accepts terminal, resume and fail with no workflow", () => {
    for (const target_kind of ["terminal", "resume", "fail"] as const) {
      const b = parseBinding({
        event_type: valid.event_type,
        routing_group: valid.routing_group,
        mode: "exclusive",
        priority: 10,
        target_kind,
        status: "ACTIVE",
        owner_module: "platform",
      });
      expect(b.target_kind).toBe(target_kind);
    }
  });
});

describe("input mapping paths", () => {
  it("catches the spec's `payload.` shorthand and names the real field", () => {
    expect(() =>
      parse({ input_mapping: { jobId: "payload.requirementId" } }),
    ).toThrow(/the envelope field is `payload_ref`/);
  });

  it("suggests the corrected path in the message", () => {
    expect(() =>
      parse({ input_mapping: { jobId: "payload.requirementId" } }),
    ).toThrow(/payload_ref\.requirementId/);
  });

  it("accepts a correct path", () => {
    expect(
      parse({ input_mapping: { jobId: "payload_ref.requirement_id" } })
        .input_mapping,
    ).toEqual({ jobId: "payload_ref.requirement_id" });
  });
});

describe("error messages", () => {
  it("names the binding by its event type", () => {
    expect(() => parse({ priority: "soon" })).toThrow(
      /BINDING_INVALID: astra\.requirement\.published/,
    );
  });

  it("names the offending field", () => {
    expect(() => parse({ mode: "sometimes" })).toThrow(/mode:/);
  });

  it("rejects an event type that is not a dotted fact name", () => {
    expect(() => parse({ event_type: "SendToSyntra" })).toThrow(
      /module\.entity\.past_tense_fact/,
    );
  });
});