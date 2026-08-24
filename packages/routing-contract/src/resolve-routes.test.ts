import { describe, expect, it } from "vitest";
import { parseBinding, type BindingEntry } from "./binding.js";
import {
  applyInputMapping,
  readPath,
  resolveRoutes,
  RoutingError,
  type RoutableEvent,
} from "./resolve-routes.js";

/* ─────────────────────────────── fixtures ────────────────────────────── */

const event: RoutableEvent = {
  event_type: "astra.requirement.published",
  organization_id: "org-acme",
};

/** A graph binding with everything defaulted; override what the test is about. */
const graph = (over: Partial<Record<string, unknown>> = {}): BindingEntry =>
  parseBinding({
    event_type: "astra.requirement.published",
    routing_group: "requirement.post-intake",
    mode: "exclusive",
    priority: 10,
    target_kind: "graph",
    workflow_key: "syntra.jd.workflow",
    module_queue: "module.syntra.jd",
    status: "ACTIVE",
    owner_module: "syntra",
    ...over,
  });

/* ──────────────────────────── what matches ───────────────────────────── */

describe("selecting bindings", () => {
  it("returns nothing when the table is empty", () => {
    expect(resolveRoutes(event, [], [])).toEqual([]);
  });

  it("returns nothing when no binding matches the event", () => {
    const other = graph({ event_type: "syntra.match.completed" });
    expect(resolveRoutes(event, [], [other])).toEqual([]);
  });

  it("ignores DRAFT and RETIRED bindings", () => {
    const table = [
      graph({ status: "DRAFT" }),
      graph({ status: "RETIRED", routing_group: "requirement.audit" }),
    ];
    expect(resolveRoutes(event, [], table)).toEqual([]);
  });

  it("returns the matching route", () => {
    const routes = resolveRoutes(event, [], [graph()]);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      workflowKey: "syntra.jd.workflow",
      moduleQueue: "module.syntra.jd",
      targetKind: "graph",
      ownerModule: "syntra",
    });
  });
});

/* ───────────────────────────── entitlements ──────────────────────────── */

describe("entitlements", () => {
  const gated = graph({ conditions: { requires_entitlement: ["SYNTRA"] } });

  it("skips a binding whose entitlement the tenant does not hold", () => {
    expect(resolveRoutes(event, ["ASTRA"], [gated])).toEqual([]);
  });

  it("returns it when the tenant holds the entitlement", () => {
    expect(resolveRoutes(event, ["ASTRA", "SYNTRA"], [gated])).toHaveLength(1);
  });

  it("requires every listed entitlement, not just one", () => {
    const both = graph({
      conditions: { requires_entitlement: ["SYNTRA", "ORBIT"] },
    });
    expect(resolveRoutes(event, ["SYNTRA"], [both])).toEqual([]);
    expect(resolveRoutes(event, ["SYNTRA", "ORBIT"], [both])).toHaveLength(1);
  });
});

/* ─────────────────────────────── fan-out ─────────────────────────────── */

describe("fanout — the thing that is impossible today", () => {
  it("fires every binding in the group", () => {
    const table = [
      graph({ mode: "fanout", priority: 10, workflow_key: "syntra.jd.workflow" }),
      graph({
        mode: "fanout",
        priority: 20,
        workflow_key: "orbit.score.workflow",
        module_queue: "module.orbit.score",
        owner_module: "orbit",
      }),
    ];
    const routes = resolveRoutes(event, [], table);
    expect(routes.map((r) => r.workflowKey)).toEqual([
      "syntra.jd.workflow",
      "orbit.score.workflow",
    ]);
  });

  it("orders by priority, lowest first", () => {
    const table = [
      graph({ mode: "fanout", priority: 30, workflow_key: "c.workflow" }),
      graph({ mode: "fanout", priority: 10, workflow_key: "a.workflow" }),
      graph({ mode: "fanout", priority: 20, workflow_key: "b.workflow" }),
    ];
    expect(
      resolveRoutes(event, [], table).map((r) => r.workflowKey),
    ).toEqual(["a.workflow", "b.workflow", "c.workflow"]);
  });

  it("gates each fanout binding on its own entitlement", () => {
    const table = [
      graph({ mode: "fanout", priority: 10, workflow_key: "syntra.jd.workflow" }),
      graph({
        mode: "fanout",
        priority: 20,
        workflow_key: "orbit.score.workflow",
        conditions: { requires_entitlement: ["ORBIT"] },
      }),
    ];
    expect(resolveRoutes(event, [], table).map((r) => r.workflowKey)).toEqual([
      "syntra.jd.workflow",
    ]);
    expect(
      resolveRoutes(event, ["ORBIT"], table).map((r) => r.workflowKey),
    ).toHaveLength(2);
  });
});

/* ────────────────────────────── exclusive ────────────────────────────── */

describe("exclusive — one winner, never a silent duplicate", () => {
  it("returns only the lowest priority when two are active", () => {
    const table = [
      graph({ priority: 20, workflow_key: "old.workflow" }),
      graph({ priority: 10, workflow_key: "new.workflow" }),
    ];
    const routes = resolveRoutes(event, [], table);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.workflowKey).toBe("new.workflow");
  });

  it("refuses to guess when two share a priority", () => {
    const table = [
      graph({ priority: 10, workflow_key: "a.workflow" }),
      graph({ priority: 10, workflow_key: "b.workflow" }),
    ];
    expect(() => resolveRoutes(event, [], table)).toThrow(RoutingError);
    expect(() => resolveRoutes(event, [], table)).toThrow(
      /sharing priority 10/,
    );
  });

  it("rejects a group whose bindings disagree about the mode", () => {
    const table = [
      graph({ mode: "exclusive", priority: 10 }),
      graph({ mode: "fanout", priority: 20, workflow_key: "other.workflow" }),
    ];
    expect(() => resolveRoutes(event, [], table)).toThrow(
      /both "exclusive" and "fanout"/,
    );
  });
});

/* ──────────────────────── groups are independent ─────────────────────── */

describe("multiple groups", () => {
  it("resolves each group separately and returns all winners", () => {
    const table = [
      graph({ routing_group: "requirement.post-intake", priority: 10 }),
      graph({
        routing_group: "requirement.audit",
        priority: 10,
        target_kind: "terminal",
        workflow_key: undefined,
        module_queue: undefined,
      }),
    ];
    const routes = resolveRoutes(event, [], table);
    expect(routes.map((r) => r.routingGroup)).toEqual([
      "requirement.audit",
      "requirement.post-intake",
    ]);
  });

  it("keeps a terminal route rather than dropping it", () => {
    const terminal = parseBinding({
      event_type: "astra.requirement.published",
      routing_group: "requirement.audit",
      mode: "exclusive",
      priority: 10,
      target_kind: "terminal",
      status: "ACTIVE",
      owner_module: "platform",
    });
    const routes = resolveRoutes(event, [], [terminal]);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.targetKind).toBe("terminal");
    expect(routes[0]?.workflowKey).toBeUndefined();
  });
});

/* ───────────────────────────── org scoping ───────────────────────────── */

describe("tenant scoping", () => {
  it("shadows the global binding when the tenant has its own", () => {
    const table = [
      graph({ org_id: null, workflow_key: "global.workflow" }),
      graph({ org_id: "org-acme", workflow_key: "canary.workflow" }),
    ];
    const routes = resolveRoutes(event, [], table);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.workflowKey).toBe("canary.workflow");
  });

  it("uses the global binding for a tenant without an override", () => {
    const table = [
      graph({ org_id: null, workflow_key: "global.workflow" }),
      graph({ org_id: "org-other", workflow_key: "canary.workflow" }),
    ];
    const routes = resolveRoutes(event, [], table);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.workflowKey).toBe("global.workflow");
  });

  it("shadows only inside the group that has the override", () => {
    const table = [
      graph({ routing_group: "a", org_id: null, workflow_key: "a.global" }),
      graph({ routing_group: "a", org_id: "org-acme", workflow_key: "a.canary" }),
      graph({ routing_group: "b", org_id: null, workflow_key: "b.global" }),
    ];
    expect(
      resolveRoutes(event, [], table).map((r) => r.workflowKey),
    ).toEqual(["a.canary", "b.global"]);
  });
});

/* ────────────────────────────── determinism ──────────────────────────── */

describe("determinism — routing simulation depends on this", () => {
  it("returns the same result whatever order the table arrives in", () => {
    const table = [
      graph({ routing_group: "z", mode: "fanout", priority: 10, workflow_key: "z1" }),
      graph({ routing_group: "a", mode: "fanout", priority: 20, workflow_key: "a2" }),
      graph({ routing_group: "a", mode: "fanout", priority: 10, workflow_key: "a1" }),
    ];
    const forward = resolveRoutes(event, [], table);
    const backward = resolveRoutes(event, [], [...table].reverse());
    expect(forward).toEqual(backward);
    expect(forward.map((r) => r.workflowKey)).toEqual(["a1", "a2", "z1"]);
  });

  it("does not mutate the table it was given", () => {
    const table = [
      graph({ mode: "fanout", priority: 30, workflow_key: "c" }),
      graph({ mode: "fanout", priority: 10, workflow_key: "a" }),
    ];
    const snapshot = JSON.stringify(table);
    resolveRoutes(event, [], table);
    expect(JSON.stringify(table)).toBe(snapshot);
  });
});

/* ──────────────────────────── input mapping ──────────────────────────── */

describe("input mapping", () => {
  const envelope = {
    event_id: "evt-1",
    organization_id: "org-acme",
    aggregate: { type: "requirement", id: "req-9" },
    payload_ref: { requirement_id: "req-9", priority: "HOT" },
  };

  it("renames envelope fields into what the graph expects", () => {
    expect(
      applyInputMapping(envelope, {
        jobId: "payload_ref.requirement_id",
        orgId: "organization_id",
      }),
    ).toEqual({ jobId: "req-9", orgId: "org-acme" });
  });

  it("reads through nested paths", () => {
    expect(applyInputMapping(envelope, { id: "aggregate.id" })).toEqual({
      id: "req-9",
    });
  });

  it("leaves a missing path out instead of setting undefined", () => {
    const out = applyInputMapping(envelope, { nope: "payload_ref.absent" });
    expect(out).toEqual({});
    expect("nope" in out).toBe(false);
  });

  it("returns an empty object when there is no mapping", () => {
    expect(applyInputMapping(envelope, undefined)).toEqual({});
  });

  it("does not fall over on a path through a non-object", () => {
    expect(readPath(envelope, "payload_ref.requirement_id.deeper")).toBeUndefined();
    expect(readPath(envelope, "missing.entirely")).toBeUndefined();
  });
});