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
  checkLiveMeansReachable,
  checkImplsPermitted,
  checkWorkNotDuplicated,
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
  /**
   * Every bound workflow appears here, and every workflow here is bound.
   *
   * The fixture used to list one graph while the bindings named two others,
   * which made "a clean run passes" assert against a platform that could not
   * exist: two events routed to workflows with no live version, and one live
   * workflow nothing could reach. `live_means_reachable` reported exactly
   * that, correctly, and three tests built on the fixture went red.
   */
  graphs: [
    { graphKey: "syntra.jd.workflow", impls: ["syntra.jd.process"] },
    /**
     * This used to run `syntra.jd.process` as well, and that was a duplicate.
     *
     * `syntra.jd.process` publishes `syntra.jd.parsed`, which the binding above
     * routes to this very workflow — so one requirement would have been parsed
     * twice, once in each. `work_not_duplicated` reported it the moment it was
     * written, against a fixture whose whole job is to describe a platform with
     * nothing wrong with it.
     *
     * Removed rather than excused. A base fixture that contains the fault the
     * suite is meant to catch cannot be the thing "a clean run passes" asserts
     * against.
     */
    { graphKey: "syntra.continuous.match", impls: ["human.gate"] },
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

  it("understands structured event declarations ({ fromConfig }) and formats them properly without [object Object]", () => {
    const out = checkEmittedEventsAnswered(
      facts({
        registry: [
          {
            key: "astra.route.decision",
            module: "astra",
            shareable: false,
            emits: [{ fromConfig: "onActionable" }, { fromConfig: "onRejected" }] as any,
          },
        ],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail).toHaveLength(2);
    expect(out.detail[0]).toContain("astra.route.decision publishes syntra.jd.normalized (fromConfig: \"onActionable\")");
    expect(out.detail[0]).not.toContain("[object Object]");
    expect(out.detail[1]).toContain("astra.route.decision publishes astra.requirement.rejected (fromConfig: \"onRejected\")");
    expect(out.detail[1]).not.toContain("[object Object]");
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

/**
 * Check 6 — does one input get the same work done to it twice?
 *
 * The live example: a workflow holding both `syntra.jd.process` and
 * `syntra.continuous.match`. The first publishes `syntra.jd.parsed`, which
 * starts a workflow that runs `syntra.continuous.match` too — so the bench is
 * searched twice for one requirement, with nothing in any log saying so.
 */
describe("checkWorkNotDuplicated", () => {
  it("catches a workflow that repeats the work of the workflow it starts", () => {
    const out = checkWorkNotDuplicated(
      facts({
        graphs: [
          {
            graphKey: "syntra.jd.workflow",
            impls: ["syntra.jd.process", "syntra.continuous.match"],
          },
          {
            graphKey: "syntra.continuous.match",
            impls: ["syntra.continuous.match"],
          },
        ],
        registry: [
          {
            key: "syntra.jd.process",
            module: "syntra",
            shareable: false,
            emits: ["syntra.jd.parsed"],
          },
          {
            key: "syntra.continuous.match",
            module: "syntra",
            shareable: true,
            emits: [],
          },
        ],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail[0]).toContain("syntra.continuous.match");
    expect(out.detail[0]).toContain("processed twice");
  });

  it("passes when a workflow starts another that shares no step", () => {
    // This is a handoff, which is the normal and intended use of an event.
    // Reporting it would make the check noise and teach people to ignore it.
    expect(checkWorkNotDuplicated(facts()).status).toBe("pass");
  });

  it("does not report a workflow reached by its own event", () => {
    /*
     * A self-trigger is a real fault and a louder one — it restarts for ever,
     * not merely twice — and the go-live gate already refuses it. Naming it
     * here too trains people to read past both messages.
     */
    const out = checkWorkNotDuplicated(
      facts({
        bindings: [
          {
            eventType: "syntra.jd.parsed",
            graphKey: "syntra.jd.workflow",
            moduleQueue: "module.syntra.jd",
          },
        ],
        graphs: [{ graphKey: "syntra.jd.workflow", impls: ["syntra.jd.process"] }],
      }),
    );
    expect(out.status).toBe("pass");
  });

  it("reports not-checked when nothing has declared its emits", () => {
    // Silence is not proof of innocence. Every legacy step is undeclared, and
    // passing here would say "no duplicates" on the strength of knowing nothing.
    const out = checkWorkNotDuplicated(
      facts({
        registry: [
          {
            key: "syntra.jd.process",
            module: "syntra",
            shareable: false,
            emits: null,
          },
          { key: "human.gate", module: "platform", shareable: true, emits: null },
        ],
      }),
    );
    expect(out.status).toBe("unchecked");
    expect(out.detail.join(" ")).toContain("declares no emits");
  });

  it("names the steps it could not check, even on a pass", () => {
    // A pass means "none of what could be checked duplicates work", which is a
    // smaller claim than "nothing duplicates work". The gap has to be visible.
    const out = checkWorkNotDuplicated(
      facts({
        registry: [
          {
            key: "syntra.jd.process",
            module: "syntra",
            shareable: false,
            emits: ["syntra.jd.parsed"],
          },
          { key: "human.gate", module: "platform", shareable: true, emits: null },
        ],
      }),
    );
    expect(out.status).toBe("pass");
    expect(out.message).toContain("could not be checked");
    expect(out.detail).toContain("human.gate declares no emits");
  });

  it("ignores an emit that depends on a setting it cannot see", () => {
    /*
     * A `{ fromConfig }` emit resolves against the step's own settings, and a
     * graph row carries only its node keys. Guessing the event name would
     * invent a finding; skipping is the honest half-answer.
     */
    const out = checkWorkNotDuplicated(
      facts({
        registry: [
          {
            key: "syntra.jd.process",
            module: "syntra",
            shareable: false,
            emits: [{ fromConfig: "outputEvent" }] as unknown as string[],
          },
          { key: "human.gate", module: "platform", shareable: true, emits: [] },
        ],
      }),
    );
    expect(out.status).toBe("pass");
  });
});

describe("runPlatformChecks", () => {
  it("returns all six, and a clean run passes", () => {
    const out = runPlatformChecks(facts());
    expect(out).toHaveLength(6);
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

/**
 * Check 5 — does "live" still mean reachable?
 *
 * The case is real: thirteen workflows in the new project were live with no
 * active binding, `syntra.authored` among them — 262 runs, last used on
 * 1 September, and unreachable ever since its binding was retired. Nothing
 * had decided that. `take-offline` retired the binding and deliberately left
 * the version live, so the two halves drifted in one direction with nothing
 * to pull them back.
 */
describe("live_means_reachable", () => {
  it("passes when every live workflow is bound and every binding is live", () => {
    expect(checkLiveMeansReachable(facts()).status).toBe("pass");
  });

  it("catches a workflow that is live and can never fire", () => {
    const out = checkLiveMeansReachable(
      facts({
        graphs: [
          { graphKey: "syntra.jd.workflow", impls: [] },
          { graphKey: "syntra.continuous.match", impls: [] },
          // Bound to nothing — the syntra.authored case.
          { graphKey: "syntra.authored", impls: [] },
        ],
      }),
    );
    expect(out.status).toBe("fail");
    // The detail names the workflow; the summary says what it means.
    expect(out.detail.join(" ")).toContain("syntra.authored");
    expect(out.detail.join(" ")).toContain("no active binding");
    expect(out.message).toContain("never fire");
  });

  it("catches a binding pointing at a workflow with no live version", () => {
    // The quieter fault: the router accepts these events and drops them.
    const out = checkLiveMeansReachable(
      facts({
        bindings: [
          {
            eventType: "syntra.jd.received",
            graphKey: "syntra.jd.workflow",
            moduleQueue: "module.syntra.jd",
          },
          {
            eventType: "relay.consent.requested",
            graphKey: "relay.gone.workflow",
            moduleQueue: "module.relay",
          },
        ],
        graphs: [{ graphKey: "syntra.jd.workflow", impls: [] }],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail.join(" ")).toContain("relay.gone.workflow");
    expect(out.detail.join(" ")).toContain("no live version");
  });

  it("reports both directions in one finding", () => {
    const out = checkLiveMeansReachable(
      facts({
        bindings: [
          {
            eventType: "relay.consent.requested",
            graphKey: "relay.gone.workflow",
            moduleQueue: "module.relay",
          },
        ],
        graphs: [{ graphKey: "syntra.authored", impls: [] }],
      }),
    );
    expect(out.status).toBe("fail");
    expect(out.detail).toHaveLength(2);
  });

  it("says it could not check rather than passing an empty platform", () => {
    const out = checkLiveMeansReachable(facts({ graphs: [] }));
    expect(out.status).toBe("unchecked");
  });
});
