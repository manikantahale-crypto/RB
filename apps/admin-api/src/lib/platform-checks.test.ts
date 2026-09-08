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
  queueActivity: new Map([
    ["module.syntra.jd", { waiting: 0, running: 1, secondsSinceCompletion: 30 }],
    ["module.syntra.match", { waiting: 1688, running: 2, secondsSinceCompletion: 21 }],
  ]),
  modules: ["syntra", "astra", "orbit", "platform", "relay", "interview"],
  handlingOf: null,
};

const facts = (over: Partial<PlatformFacts> = {}): PlatformFacts => ({
  ...base,
  ...over,
});

describe("bindings_routable", () => {
  it("passes when every binding's queue is being worked", () => {
    expect(checkBindingsRoutable(facts()).status).toBe("pass");
  });

  it("does not call a busy queue dead just because it has a backlog", () => {
    // module.syntra.match really did have 1,688 jobs waiting while working
    // through them at speed. A backlog is not an absent consumer.
    const out = checkBindingsRoutable(facts());
    expect(out.status).toBe("pass");
  });

  it("catches work piling up with nobody collecting it", () => {
    const out = checkBindingsRoutable(
      facts({
        bindings: [
          {
            eventType: "relay.consent.requested",
            graphKey: "relay.consent.workflow",
            moduleQueue: "module.relay",
          },
        ],
        queueActivity: new Map([
          ["module.relay", { waiting: 725, running: 0, secondsSinceCompletion: 86_400 }],
        ]),
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("725 waiting");
    expect(out.detail[0]).toContain("none running");
  });

  it("catches a queue that has never completed anything", () => {
    const out = checkBindingsRoutable(
      facts({
        bindings: [
          {
            eventType: "x.happened",
            graphKey: "x.workflow",
            moduleQueue: "module.x",
          },
        ],
        queueActivity: new Map([
          ["module.x", { waiting: 3, running: 0, secondsSinceCompletion: null }],
        ]),
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("nothing ever completed");
  });

  it("stays quiet about a queue that has never had a job", () => {
    // Nothing is stuck, so there is nothing to report. The first event to
    // arrive creates the queue.
    const out = checkBindingsRoutable(
      facts({
        bindings: [
          {
            eventType: "brand.new",
            graphKey: "new.workflow",
            moduleQueue: "module.brandnew",
          },
        ],
      }),
    );
    expect(out.status).toBe("pass");
  });

  it("flags a binding that names no queue at all", () => {
    const out = checkBindingsRoutable(
      facts({
        bindings: [
          { eventType: "a.b", graphKey: "a.workflow", moduleQueue: null },
        ],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("no queue at all");
  });

  it("says not checked rather than passing with no activity data", () => {
    const out = checkBindingsRoutable(facts({ queueActivity: new Map() }));
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

describe("routing_hazards", () => {
  it("is not checked when nothing says how events are handled", () => {
    const out = checkEventsHandled(facts());
    expect(out.status).toBe("unchecked");
  });

  it("passes when no binding sits on a control-plane event", () => {
    const out = checkEventsHandled(
      facts({
        handlingOf: new Map([
          ["syntra.jd.received", "graph"],
          ["syntra.jd.parsed", "graph"],
        ]),
      }),
    );
    expect(out.status).toBe("pass");
  });

  it("reports the bindings that run only because the binding now wins", () => {
    // Proof the routing fix is doing something: under the old ordering these
    // were acknowledged and dropped before the binding was read.
    const out = checkEventsHandled(
      facts({
        handlingOf: new Map([
          ["syntra.jd.received", "graph"],
          ["syntra.jd.parsed", "terminal"],
        ]),
      }),
    );
    expect(out.status).toBe("pass");
    expect(out.message).toContain("binding now wins");
    expect(out.detail[0]).toContain("syntra.jd.parsed");
  });

  it("fails on a workflow bound to a control-plane event", () => {
    // `resume` unparks a waiting human gate. A bound workflow now starts as
    // well, so two things happen and only one of them is obvious.
    const out = checkEventsHandled(
      facts({
        bindings: [
          {
            eventType: "syntra.approval.decided",
            graphKey: "syntra.authored",
            moduleQueue: "module.syntra.jd",
          },
        ],
        handlingOf: new Map([["syntra.approval.decided", "resume"]]),
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("resumes a parked thread AND starts");
  });

  it("does not flag an ordinary graph binding as a hazard", () => {
    const out = checkEventsHandled(
      facts({ handlingOf: new Map([["syntra.jd.received", "graph"]]) }),
    );
    // syntra.jd.parsed is simply unknown to the map, which is fine now.
    expect(out.status).toBe("pass");
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
