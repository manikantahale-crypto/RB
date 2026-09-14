/**
 * What the approver is told will happen, against what the router will do.
 *
 * These matter more than most tests here: the whole point of the release
 * console is that the person approving is shown the consequence rather than
 * asked to imagine it. A simulation that is subtly wrong is worse than none,
 * because it is trusted.
 *
 * The cases are the live ones — `syntra.match.requested` answered by
 * `syntra.match.workflow`, and the takeover that a second application's
 * binding would represent.
 */

import { describe, expect, it } from "vitest";
import { previewRelease, toBindingEntry, type StoredBinding } from "./release-preview.js";

const binding = (over: Partial<StoredBinding> = {}): StoredBinding => ({
  id: "b1",
  eventType: "syntra.match.requested",
  orgId: null,
  graphKey: "syntra.match.workflow",
  queueKey: "module.syntra.match",
  consumingApplication: "syntra",
  priority: 100,
  requiresFeature: null,
  status: "active",
  ...over,
});

describe("toBindingEntry", () => {
  it("uses the consuming application as the routing group", () => {
    // There is no routing_group column: the group IS (org, event, application)
    // by design, so deriving it is the only way the two cannot disagree.
    const e = toBindingEntry(binding());
    expect(e.routing_group).toBe("syntra");
    expect(e.owner_module).toBe("syntra");
  });

  it("maps an authoring status onto the contract's", () => {
    expect(toBindingEntry(binding()).status).toBe("ACTIVE");
    expect(toBindingEntry(binding({ status: "retired" })).status).toBe("RETIRED");
  });

  it("carries the feature gate through as an entitlement", () => {
    const e = toBindingEntry(binding({ requiresFeature: ["beta.matching"] }));
    expect(e.conditions.requires_entitlement).toEqual(["beta.matching"]);
  });
});

describe("previewRelease", () => {
  it("reports no change when the same workflow is already bound", () => {
    // Releasing v8 over v7 of the same workflow changes the version, not the
    // routing. Saying "nothing moves" is the honest answer and is what stops
    // an approver looking for a consequence that is not there.
    const out = previewRelease({
      eventType: "syntra.match.requested",
      orgId: null,
      current: [binding()],
      approving: binding({ id: "b2" }),
    });
    expect(out.gaining).toEqual([]);
    expect(out.losing).toEqual([]);
    expect(out.after.map((r) => r.workflowKey)).toEqual([
      "syntra.match.workflow",
    ]);
  });

  it("names the workflow that stops receiving the event", () => {
    // The case that needs saying out loud: approving this takes the event off
    // something that is running today.
    const out = previewRelease({
      eventType: "syntra.match.requested",
      orgId: null,
      current: [binding({ graphKey: "syntra.old.matcher" })],
      approving: binding({ id: "b2", graphKey: "syntra.match.workflow" }),
    });
    expect(out.losing).toEqual(["syntra.old.matcher"]);
    expect(out.gaining).toEqual(["syntra.match.workflow"]);
  });

  it("adds a route without taking one away when the group differs", () => {
    // A second application answering the same event is fan-out, not a
    // takeover — the groups are separate, so both run.
    const out = previewRelease({
      eventType: "syntra.match.requested",
      orgId: null,
      current: [binding()],
      approving: binding({
        id: "b2",
        graphKey: "orbit.match.listener",
        consumingApplication: "orbit",
        queueKey: "module.orbit.bench",
      }),
    });
    expect(out.losing).toEqual([]);
    expect(out.gaining).toEqual(["orbit.match.listener"]);
    expect(out.after).toHaveLength(2);
  });

  it("leaves other events alone", () => {
    const out = previewRelease({
      eventType: "syntra.match.requested",
      orgId: null,
      current: [
        binding(),
        binding({ id: "b9", eventType: "syntra.jd.parsed", graphKey: "other" }),
      ],
      approving: binding({ id: "b2" }),
    });
    expect(out.after.map((r) => r.workflowKey)).toEqual([
      "syntra.match.workflow",
    ]);
  });

  it("says a route is gated rather than dropping it", () => {
    /*
     * resolveRoutes removes a binding whose entitlement is not held, and this
     * asks the global question with none held. Without naming the gate, a
     * gated route would vanish from both sides and the screen would report
     * "nothing changes" for a release that changes something for every
     * customer who holds the flag.
     */
    const out = previewRelease({
      eventType: "syntra.match.requested",
      orgId: null,
      current: [],
      approving: binding({ requiresFeature: ["beta.matching"] }),
      entitlements: ["beta.matching"],
    });
    expect(out.gaining).toEqual(["syntra.match.workflow"]);
    expect(out.after[0]!.gatedOn).toEqual(["beta.matching"]);
  });

  it("ignores bindings that are already retired", () => {
    const out = previewRelease({
      eventType: "syntra.match.requested",
      orgId: null,
      current: [binding({ graphKey: "syntra.dead.matcher", status: "retired" })],
      approving: binding({ id: "b2" }),
    });
    expect(out.before).toEqual([]);
    expect(out.losing).toEqual([]);
    expect(out.gaining).toEqual(["syntra.match.workflow"]);
  });

  it("is the first route for an event nothing answered", () => {
    const out = previewRelease({
      eventType: "syntra.match.requested",
      orgId: null,
      current: [],
      approving: binding(),
    });
    expect(out.before).toEqual([]);
    expect(out.after).toHaveLength(1);
    expect(out.gaining).toEqual(["syntra.match.workflow"]);
  });
});
