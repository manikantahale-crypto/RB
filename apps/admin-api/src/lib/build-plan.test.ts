/**
 * The plan an author approves before anything happens.
 *
 * The fixture is the worked example from the design: a requirement arrives in
 * ASTRA, crosses to SYNTRA on `syntra.jd.normalized`, and SYNTRA matches. Both
 * halves already exist, so the honest answer is "nothing needs building" —
 * which is the case the old one-graph proposal handled worst, because it
 * offered to build a second copy of work that was already running.
 */
import { describe, expect, it } from "vitest";
import { buildPlan, type EventFacts } from "./build-plan.js";
import type { EmitDeclaration } from "@tekisho/node-contract";

const eventFacts = new Map<string, EventFacts>([
  [
    "syntra.jd.normalized",
    {
      eventType: "syntra.jd.normalized",
      description:
        "ASTRA accepted a requirement as actionable; SYNTRA matching may proceed.",
      producedWhen: "ASTRA route decision passed.",
      publishCount: 96,
    },
  ],
]);

const emitsOf = new Map<string, EmitDeclaration[] | null>([
  ["astra.route.decision", [{ fromConfig: "onActionable" }]],
  ["syntra.jd.process", ["syntra.jd.parsed"]],
  ["astra.requirement.intake", null],
]);

const astraStep = {
  module: "astra",
  yours: false,
  steps: ["route"],
  nodes: [
    {
      id: "route",
      impl: "astra.route.decision",
      config: { onActionable: "syntra.jd.normalized" },
    },
  ],
  startsWith: null,
  alreadyBuilt: "astra.requirement.workflow",
};

const syntraStep = {
  module: "syntra",
  yours: true,
  steps: ["jd"],
  nodes: [{ id: "jd", impl: "syntra.jd.process" }],
  startsWith: {
    fromModule: "astra",
    toModule: "syntra",
    eventType: "syntra.jd.normalized",
    exists: true,
    handledBy: "syntra.authored",
  },
  alreadyBuilt: "syntra.authored",
};

const base = {
  triggerEventType: "astra.requirement.received",
  eventFacts,
  boundTo: new Map([["syntra.jd.normalized", "syntra.authored"]]),
  queueOf: new Map([["syntra.jd.normalized", "module.syntra.jd"]]),
  workedQueues: new Set(["module.syntra.jd", "module.syntra.match"]),
  versionOf: new Map([
    ["astra.requirement.workflow", 3],
    ["syntra.authored", 119],
  ]),
  emitsOf,
};

const plan = (chain: any[], over = {}) =>
  buildPlan({ ...base, chain, ...over } as any);

describe("buildPlan", () => {
  it("draws every application the outcome passes through", () => {
    // Not one graph with an apology attached. The author asked for an outcome;
    // the outcome is three boxes and the events between them.
    const out = plan([astraStep, syntraStep]);
    expect(out.steps.map((s) => s.module)).toEqual(["astra", "syntra"]);
    expect(out.steps.map((s) => s.state)).toEqual(["exists", "exists"]);
  });

  it("says nothing needs building when the outcome already runs", () => {
    // The most common real case and the one the old proposal handled worst:
    // it offered to build a second copy of a workflow that already existed.
    const out = plan([astraStep, syntraStep]);
    expect(out.satisfied).toBe(true);
    expect(out.verdict).toContain("already runs");
  });

  it("carries the event's own words onto the link", () => {
    // The seam is real, so it is drawn — but it must not be illegible. The
    // name alone is not enough to judge by.
    const [link] = plan([astraStep, syntraStep]).links;
    expect(link!.eventType).toBe("syntra.jd.normalized");
    expect(link!.description).toContain("SYNTRA matching may proceed");
    expect(link!.producedWhen).toBe("ASTRA route decision passed.");
    expect(link!.publishCount).toBe(96);
    expect(link!.emitted).toBe("yes");
  });

  it("marks a step NEW when nothing is bound to its trigger", () => {
    const out = plan([astraStep, { ...syntraStep, alreadyBuilt: null }]);
    expect(out.steps[1]!.state).toBe("new");
    expect(out.satisfied).toBe(false);
    expect(out.verdict).toContain("1 of 2");
  });

  it("blocks a step when no event crosses into it", () => {
    // The case that genuinely needs a developer. A plan that says so is a far
    // better answer than a graph that quietly stops.
    const out = plan([astraStep, { ...syntraStep, startsWith: null, alreadyBuilt: null }]);
    expect(out.steps[1]!.state).toBe("blocked");
    expect(out.links[0]!.blocked).toBe(true);
    expect(out.links[0]!.reason).toContain("No event carries ASTRA to SYNTRA");
    expect(out.verdict).toContain("cannot run");
  });

  it("blocks when the previous step provably publishes nothing", () => {
    // Every node there has declared its emits and none of them is the join.
    // That is the silent failure this whole check exists to catch: the first
    // workflow succeeds, the second never starts, nothing reports it.
    const silent = {
      ...astraStep,
      nodes: [{ id: "route", impl: "syntra.jd.process" }],
    };
    const out = plan([silent, { ...syntraStep, alreadyBuilt: null }]);
    expect(out.links[0]!.emitted).toBe("no");
    expect(out.steps[1]!.state).toBe("blocked");
    expect(out.links[0]!.reason).toContain("publishes");
  });

  it("does not block on an undeclared step", () => {
    // ASTRA has no contracts, so nothing is known about what it publishes.
    // Treating unknown as silent would block chains that work perfectly well.
    const undeclared = {
      ...astraStep,
      nodes: [{ id: "intake", impl: "astra.requirement.intake" }],
    };
    const out = plan([undeclared, { ...syntraStep, alreadyBuilt: null }]);
    expect(out.links[0]!.emitted).toBe("unknown");
    expect(out.steps[1]!.state).toBe("new");
    expect(out.links[0]!.blocked).toBe(false);
  });

  it("warns when a bound event sits on a queue nobody serves", () => {
    // Five live bindings are in exactly this state. The event is accepted,
    // routed, queued — and never picked up.
    const out = plan([astraStep, syntraStep], {
      queueOf: new Map([["syntra.jd.normalized", "module.relay"]]),
    });
    expect(out.links[0]!.bound).toBe(true);
    expect(out.links[0]!.routable).toBe(false);
    expect(out.links[0]!.reason).toContain("not");
    expect(out.links[0]!.reason).toContain("worker");
  });

  it("puts the live version on an existing step", () => {
    // "syntra.authored v119 → v120" is only sayable if v119 is known.
    const out = plan([astraStep, syntraStep]);
    expect(out.steps[0]!.version).toBe(3);
    expect(out.steps[1]!.version).toBe(119);
  });

  it("never blocks the first step — the author chose its trigger", () => {
    const out = plan([{ ...astraStep, alreadyBuilt: null }]);
    expect(out.steps[0]!.state).toBe("new");
    expect(out.links).toEqual([]);
  });

  it("copes with a single-application plan", () => {
    const out = plan([syntraStep]);
    expect(out.steps).toHaveLength(1);
    expect(out.links).toEqual([]);
    expect(out.satisfied).toBe(true);
  });
});
