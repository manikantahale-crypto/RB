/**
 * The four checks that say whether the platform is telling the truth.
 *
 * Fixtures are the live faults these were written to catch: bindings on
 * `module.relay`, which no worker serves, and `orch.switch`, which appears in
 * four active graphs and no registry.
 */
import { describe, expect, it } from "vitest";
import {
  allPassed,
  checkBindingsRoutable,
  checkEmittedEventsAnswered,
  checkEventsHandled,
  checkImplsPermitted,
  runPlatformChecks,
  type PlatformFacts,
} from "./platform-checks.js";

const base: PlatformFacts = {
  bindings: [
    {
      eventType: "syntra.jd.received",
      graphKey: "syntra.jd.workflow",
      moduleQueue: "module.syntra.jd",
    },
    {
      eventType: "syntra.jd.parsed",
      graphKey: "syntra.continuous.match",
      moduleQueue: "module.syntra.match",
    },
  ],
  graphs: [
    { graphKey: "syntra.authored", impls: ["syntra.jd.process", "human.gate"] },
  ],
  registry: [
    {
      key: "syntra.jd.process",
      module: "syntra",
      shareable: false,
      emits: ["syntra.jd.parsed"],
    },
    { key: "human.gate", module: "platform", shareable: true, emits: [] },
  ],
  workedQueues: new Set(["module.syntra.jd", "module.syntra.match"]),
  modules: ["syntra", "astra", "orbit", "platform", "relay", "interview"],
  handlingOf: null,
};

const facts = (over: Partial<PlatformFacts> = {}): PlatformFacts => ({
  ...base,
  ...over,
});

describe("bindings_routable", () => {
  it("passes when every binding sits on a served queue", () => {
    expect(checkBindingsRoutable(facts()).status).toBe("pass");
  });

  it("catches a binding routing into nowhere", () => {
    // The live fault: five bindings on module.relay and module.interview. The
    // event is accepted, routed, enqueued — and nobody comes. No error, because
    // nothing failed.
    const out = checkBindingsRoutable(
      facts({
        bindings: [
          ...base.bindings,
          {
            eventType: "relay.consent.requested",
            graphKey: "relay.intake.workflow",
            moduleQueue: "module.relay",
          },
        ],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.message).toContain("accepted and then dropped");
    expect(out.detail).toEqual([
      "relay.consent.requested → relay.intake.workflow on module.relay",
    ]);
  });

  it("says not checked rather than passing with no queue list", () => {
    const out = checkBindingsRoutable(facts({ workedQueues: new Set() }));
    expect(out.status).toBe("unchecked");
  });
});

describe("impls_permitted", () => {
  it("passes when every step is in a palette the graph would be offered", () => {
    // `human.gate` belongs to platform, not syntra — but it is shareable, so
    // it is permitted. That distinction is the whole check.
    expect(checkImplsPermitted(facts()).status).toBe("pass");
  });

  it("catches a step that is in no registry at all", () => {
    // `orch.switch`, live in four active graphs. Nothing knows what it takes
    // or returns, so it cannot be validated, tested, or offered.
    const out = checkImplsPermitted(
      facts({
        graphs: [{ graphKey: "relay.intake.workflow", impls: ["orch.switch"] }],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("not in the registry");
  });

  it("catches a step borrowed from another application", () => {
    const out = checkImplsPermitted(
      facts({
        graphs: [
          { graphKey: "relay.intake.workflow", impls: ["astra.requirement.intake"] },
        ],
        registry: [
          {
            key: "astra.requirement.intake",
            module: "astra",
            shareable: false,
            emits: null,
          },
        ],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("owned by astra and not shareable");
  });

  it("stays silent on a key that names no application", () => {
    // `duplicate.review` is not an application called "duplicate". Trusting the
    // first segment reported every step inside it as a boundary crossing, and a
    // check that produces false findings gets ignored.
    const out = checkImplsPermitted(
      facts({
        graphs: [{ graphKey: "duplicate.review", impls: ["syntra.jd.process"] }],
      }),
    );
    expect(out.status).toBe("pass");
  });
});

describe("emitted_events_answered", () => {
  it("passes when every published event has a listener", () => {
    expect(checkEmittedEventsAnswered(facts()).status).toBe("pass");
  });

  it("reports an event nothing answers", () => {
    const out = checkEmittedEventsAnswered(
      facts({
        registry: [
          {
            key: "syntra.bench.alert",
            module: "syntra",
            shareable: false,
            emits: ["syntra.match.requested"],
          },
        ],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("nothing answers it");
    // Not every orphan is wrong — an event may go to a screen rather than a
    // workflow — so the message asks for judgement rather than issuing one.
    expect(out.message).toContain("read the list");
  });

  it("says not checked when no node has declared its emits", () => {
    // Exactly the state before the registry is materialised. Passing here
    // would read as "no dead ends" when the truth is "nobody looked".
    const out = checkEmittedEventsAnswered(
      facts({
        registry: [
          { key: "a", module: "syntra", shareable: false, emits: null },
        ],
      }),
    );
    expect(out.status).toBe("unchecked");
    expect(out.message).toContain("Re-materialise");
  });

  it("ignores a node that declares it publishes nothing", () => {
    // `emits: []` is a real answer. Only `null` is unknown.
    const out = checkEmittedEventsAnswered(
      facts({
        registry: [
          { key: "syntra.run.retry", module: "syntra", shareable: false, emits: [] },
        ],
      }),
    );
    expect(out.status).toBe("pass");
  });
});

describe("events_handled", () => {
  it("is not checked while the catalogue records no handling", () => {
    const out = checkEventsHandled(facts());
    expect(out.status).toBe("unchecked");
    expect(out.message).toContain("does not record how an event is handled");
  });

  it("catches a binding on an event no graph is said to handle, once it can", () => {
    const out = checkEventsHandled(
      facts({
        handlingOf: new Map([["syntra.jd.received", "graph"]]),
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("syntra.jd.parsed");
  });
});

describe("runPlatformChecks", () => {
  it("returns all four, and a clean run passes", () => {
    const out = runPlatformChecks(facts());
    expect(out).toHaveLength(4);
    expect(allPassed(out)).toBe(true);
  });

  it("does not let not-checked count as a failure", () => {
    // Otherwise the suite is red from the day it lands, for a column that does
    // not exist yet, and everybody starts ignoring it.
    const out = runPlatformChecks(facts());
    expect(out.some((f) => f.status === "unchecked")).toBe(true);
    expect(allPassed(out)).toBe(true);
  });

  it("fails when any check fails", () => {
    const out = runPlatformChecks(
      facts({
        graphs: [{ graphKey: "relay.intake.workflow", impls: ["orch.switch"] }],
      }),
    );
    expect(allPassed(out)).toBe(false);
  });
});
