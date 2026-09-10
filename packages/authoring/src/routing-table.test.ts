/**
 * The mapping that makes fan-out possible, and the rule that stops it becoming
 * duplicate work.
 *
 * These tests run the real `resolveRoutes` against mapped rows rather than
 * asserting on the mapping's shape. The shape is a means; what matters is how
 * many runs an event produces and which.
 */
import { describe, expect, it } from "vitest";
import { resolveRoutes } from "@tekisho/routing-contract";
import { toBindingEntries, type BindingRow } from "./routing-table.js";

const row = (over: Partial<BindingRow> = {}): BindingRow => ({
  id: "b1",
  org_id: null,
  event_type: "astra.requirement.published",
  graph_key: "syntra.match.workflow",
  queue_key: "module.syntra.match",
  consuming_application: "syntra",
  priority: 100,
  requires_feature: null,
  status: "active",
  ...over,
});

const routesFor = (rows: BindingRow[], entitlements: string[] = []) =>
  resolveRoutes(
    { event_type: "astra.requirement.published", organization_id: "org-1" },
    entitlements,
    toBindingEntries(rows).entries,
  );

describe("two applications answering one event", () => {
  it("produces a run for each — this is fan-out", () => {
    // The case the design document names: ORBIT wants to answer an event
    // SYNTRA already answers. Before this, the only options were to take
    // SYNTRA's binding or edit SYNTRA's workflow.
    const routes = routesFor([
      row({ id: "syntra", consuming_application: "syntra" }),
      row({
        id: "orbit",
        consuming_application: "orbit",
        graph_key: "orbit.lifecycle.workflow",
        queue_key: "module.orbit.bench",
      }),
    ]);

    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.workflowKey).sort()).toEqual([
      "orbit.lifecycle.workflow",
      "syntra.match.workflow",
    ]);
  });

  it("keeps them in separate groups, so neither can silence the other", () => {
    const { entries } = toBindingEntries([
      row({ consuming_application: "syntra" }),
      row({ consuming_application: "orbit" }),
    ]);
    expect(new Set(entries.map((e) => e.routing_group)).size).toBe(2);
  });
});

describe("one application answering one event twice", () => {
  it("refuses, rather than running the same work twice", () => {
    // Same application, same event, two workflows. The right answer is another
    // node on the existing workflow, so the resolver raises instead of
    // choosing — silently picking one is the failure exclusivity exists to
    // prevent.
    const boom = (() => {
      try {
        routesFor([
          row({ id: "a", graph_key: "one.workflow" }),
          row({ id: "b", graph_key: "two.workflow" }),
        ]);
        return null;
      } catch (e) {
        return e as { code?: string; message: string };
      }
    })();

    expect(boom?.code).toBe("ROUTING_AMBIGUOUS");
    // And it names both workflows, so the message is actionable.
    expect(boom?.message).toContain("one.workflow");
    expect(boom?.message).toContain("two.workflow");
  });

  it("takes the lower priority when they are ranked", () => {
    const routes = routesFor([
      row({ id: "a", graph_key: "one.workflow", priority: 50 }),
      row({ id: "b", graph_key: "two.workflow", priority: 100 }),
    ]);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.workflowKey).toBe("one.workflow");
  });
});

describe("tenants", () => {
  it("lets one customer's binding shadow the global one", () => {
    const routes = routesFor([
      row({ id: "global", org_id: null, graph_key: "standard.workflow" }),
      row({ id: "theirs", org_id: "org-1", graph_key: "their.workflow" }),
    ]);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.workflowKey).toBe("their.workflow");
  });

  it("does not leak another customer's binding", () => {
    const routes = routesFor([
      row({ id: "other", org_id: "org-2", graph_key: "not.theirs" }),
    ]);
    expect(routes).toEqual([]);
  });
});

describe("what does not become a route", () => {
  it("drops a binding whose workflow no longer exists, and says so", () => {
    // The LEFT JOIN leaves graph_key null. Enqueueing it would fail later with
    // a worse message than "this binding names nothing".
    const { entries, dropped } = toBindingEntries([row({ graph_key: null })]);
    expect(entries).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it("skips a binding whose feature the customer does not hold", () => {
    expect(routesFor([row({ requires_feature: "syntra.auto_shortlist" })])).toEqual([]);
    expect(
      routesFor([row({ requires_feature: "syntra.auto_shortlist" })], [
        "syntra.auto_shortlist",
      ]),
    ).toHaveLength(1);
  });

  it("returns nothing when no binding answers, which is a valid answer", () => {
    // An empty array means "acknowledge and move on". It must never mean
    // "fall back to code".
    expect(routesFor([])).toEqual([]);
  });
});
