/**
 * Splitting one authored flow into the workflows that will run.
 *
 * The case throughout is the live one: ASTRA gates a requirement, hands off via
 * `syntra.jd.normalized`, and SYNTRA matches. An author writes that as one
 * flow; whether the platform stores it as one or two is `decideChain`'s call,
 * and it splits only when there is existing work downstream to hand off to.
 */
import { describe, expect, it } from "vitest";
import {
  decideChain,
  detectTriggeredWorkflows,
  emitsEvent,
  orderedSteps,
  resolveHandoff,
  splitByModule,
  type Handoff,
  type ModuleFacts,
  type SplitStep,
} from "./split-cross-module.js";

const moduleOf = new Map<string, string>([
  ["astra.requirement.quality", "astra"],
  ["astra.requirement.normalize", "astra"],
  ["astra.route.decision", "astra"],
  ["syntra.match.process", "syntra"],
  ["syntra.shortlist.notify", "syntra"],
  ["orbit.placement.confirm", "orbit"],
  ["human.gate", "platform"],
  ["orch.branch.decision", "platform"],
]);
/** Lent to everyone — borrowing one is not a handoff. */
const shareable = new Set(["human.gate", "orch.branch.decision"]);

const split = (nodes: SplitStep[], edges: Array<[string, string]>) =>
  splitByModule({ nodes, edges, moduleOf, shareable });

/** A linear flow: __start__ → a → b → … → __end__ */
function linear(steps: Array<[string, string]>) {
  const nodes = steps.map(([id, impl]) => ({ id, impl }));
  const edges: Array<[string, string]> = [["__start__", steps[0]![0]]];
  for (let i = 0; i < steps.length - 1; i += 1) {
    edges.push([steps[i]![0], steps[i + 1]![0]]);
  }
  edges.push([steps[steps.length - 1]![0], "__end__"]);
  return { nodes, edges };
}

describe("a flow inside one application", () => {
  it("is left alone", () => {
    const { nodes, edges } = linear([
      ["match", "syntra.match.process"],
      ["notify", "syntra.shortlist.notify"],
    ]);
    const out = split(nodes, edges);
    expect(out.singleModule).toBe(true);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.module).toBe("syntra");
  });
});

describe("a flow that crosses applications", () => {
  const { nodes, edges } = linear([
    ["quality", "astra.requirement.quality"],
    ["route", "astra.route.decision"],
    ["match", "syntra.match.process"],
  ]);

  it("cuts where the owning application changes", () => {
    const out = split(nodes, edges);
    expect(out.singleModule).toBe(false);
    expect(out.segments.map((s) => s.module)).toEqual(["astra", "syntra"]);
    expect(out.segments[0]!.stepIds).toEqual(["quality", "route"]);
    expect(out.segments[1]!.stepIds).toEqual(["match"]);
  });

  it("gives each segment a runnable shape of its own", () => {
    const out = split(nodes, edges);
    expect(out.segments[0]!.edges).toEqual([
      ["__start__", "quality"],
      ["quality", "route"],
      ["route", "__end__"],
    ]);
    expect(out.segments[1]!.edges).toEqual([
      ["__start__", "match"],
      ["match", "__end__"],
    ]);
  });

  it("handles three applications in a row", () => {
    const three = linear([
      ["quality", "astra.requirement.quality"],
      ["match", "syntra.match.process"],
      ["place", "orbit.placement.confirm"],
    ]);
    expect(split(three.nodes, three.edges).segments.map((s) => s.module)).toEqual([
      "astra",
      "syntra",
      "orbit",
    ]);
  });
});

describe("shared steps do not cut the flow", () => {
  it("keeps a gate with the work it gates", () => {
    // The whole point of `shareable`: borrowing a capability is not a handoff.
    // Treating human.gate as its own owner would cut ASTRA into three.
    const { nodes, edges } = linear([
      ["quality", "astra.requirement.quality"],
      ["gate", "human.gate"],
      ["route", "astra.route.decision"],
    ]);
    const out = split(nodes, edges);
    expect(out.singleModule).toBe(true);
    expect(out.segments[0]!.stepIds).toEqual(["quality", "gate", "route"]);
  });

  it("gives a leading shared step to whoever comes first", () => {
    const { nodes, edges } = linear([
      ["gate", "human.gate"],
      ["match", "syntra.match.process"],
    ]);
    const out = split(nodes, edges);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.module).toBe("syntra");
    expect(out.segments[0]!.stepIds).toEqual(["gate", "match"]);
  });

  it("does not invent an owner for a flow of only shared steps", () => {
    const { nodes, edges } = linear([
      ["gate", "human.gate"],
      ["branch", "orch.branch.decision"],
    ]);
    const out = split(nodes, edges);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.module).toBe("platform");
  });
});

describe("orderedSteps", () => {
  it("follows the edges rather than the array order", () => {
    const nodes = [
      { id: "b", impl: "syntra.match.process" },
      { id: "a", impl: "astra.requirement.quality" },
    ];
    const edges: Array<[string, string]> = [
      ["__start__", "a"],
      ["a", "b"],
      ["b", "__end__"],
    ];
    expect(orderedSteps(nodes, edges)).toEqual(["a", "b"]);
  });

  it("still reports a step nothing reaches", () => {
    // Losing it in the split would be worse than showing it out of place.
    const nodes = [
      { id: "a", impl: "astra.requirement.quality" },
      { id: "orphan", impl: "syntra.match.process" },
    ];
    const edges: Array<[string, string]> = [
      ["__start__", "a"],
      ["a", "__end__"],
    ];
    expect(orderedSteps(nodes, edges)).toContain("orphan");
  });
});

describe("resolveHandoff", () => {
  const astra: ModuleFacts = {
    key: "astra",
    handsOff: ["syntra.jd.normalized", "astra.requirement.rejected"],
    frontDoor: ["astra.requirement.received"],
  };
  const syntra: ModuleFacts = {
    key: "syntra",
    handsOff: ["syntra.candidate.submitted"],
    frontDoor: ["syntra.jd.normalized"],
  };
  const known = new Set([
    "syntra.jd.normalized",
    "astra.requirement.rejected",
    "astra.requirement.received",
    "syntra.candidate.submitted",
  ]);

  it("prefers a road both sides already agreed on", () => {
    const h = resolveHandoff(astra, syntra, known, new Map());
    expect(h.eventType).toBe("syntra.jd.normalized");
    expect(h.exists).toBe(true);
  });

  it("says when that half already runs, so nothing needs building", () => {
    const bound = new Map([["syntra.jd.normalized", "syntra.authored"]]);
    expect(resolveHandoff(astra, syntra, known, bound).handledBy).toBe(
      "syntra.authored",
    );
  });

  it("falls back to something the upstream already publishes", () => {
    const stranger: ModuleFacts = { key: "relay", handsOff: [], frontDoor: [] };
    const h = resolveHandoff(astra, stranger, known, new Map());
    expect(h.exists).toBe(true);
    expect(astra.handsOff).toContain(h.eventType);
  });

  it("proposes one only when nothing fits, naming both sides", () => {
    const a: ModuleFacts = { key: "interview", handsOff: [], frontDoor: [] };
    const b: ModuleFacts = { key: "relay", handsOff: [], frontDoor: [] };
    const h = resolveHandoff(a, b, new Set(), new Map());
    expect(h.exists).toBe(false);
    // The name outlives whatever prompted it, so it says which two it joins.
    expect(h.eventType).toContain("interview");
    expect(h.eventType).toContain("relay");
  });
});

describe("decideChain", () => {
  const handoff = (over: Partial<Handoff> = {}): Handoff => ({
    fromModule: "astra",
    toModule: "syntra",
    eventType: "syntra.jd.normalized",
    exists: true,
    handledBy: null,
    ...over,
  });

  it("splits when the downstream work already exists", () => {
    // The one case worth an event boundary: handing off to a workflow a team
    // already built and maintains, instead of growing a second copy of it.
    const out = decideChain([null, handoff({ handledBy: "syntra.authored" })]);
    expect(out.chain).toBe(true);
    expect(out.reason).toContain("syntra.authored");
  });

  it("keeps one workflow when there is nothing to reuse", () => {
    // Two halves joined by an event nobody publishes is the failure this
    // whole decision exists to avoid. One graph runs the whole way through.
    expect(decideChain([null, handoff()]).chain).toBe(false);
  });

  it("does not split on an event that merely exists", () => {
    // `exists` means the catalogue knows the name. It says nothing about
    // whether any workflow answers it, which is the part that matters.
    expect(decideChain([null, handoff({ exists: true, handledBy: null })]).chain)
      .toBe(false);
  });

  it("names every workflow being reused", () => {
    const out = decideChain([
      null,
      handoff({ handledBy: "syntra.authored" }),
      handoff({ fromModule: "syntra", toModule: "orbit", handledBy: "orbit.bench" }),
    ]);
    expect(out.chain).toBe(true);
    expect(out.reason).toContain("syntra.authored");
    expect(out.reason).toContain("orbit.bench");
  });

  it("stays one workflow when the flow never left home", () => {
    expect(decideChain([]).chain).toBe(false);
  });
});

describe("emitsEvent", () => {
  const declared = (pairs: Array<[string, unknown[] | null]>) =>
    new Map<string, any>(pairs);

  it("finds a handoff carried in an undeclared step's settings", () => {
    // How `astra.route.decision` publishes: the target is a design-time
    // setting, so it is visible even though ASTRA has declared nothing.
    const out = emitsEvent({
      nodes: [
        { id: "a", impl: "astra.quality.gate", config: { passMin: 0.6 } },
        {
          id: "b",
          impl: "astra.route.decision",
          config: { onActionable: "syntra.jd.normalized" },
        },
      ],
      eventType: "syntra.jd.normalized",
      emitsOf: declared([]),
    });
    expect(out).toBe("yes");
  });

  it("finds an event a node declared outright", () => {
    const out = emitsEvent({
      nodes: [{ id: "a", impl: "syntra.jd.process", config: {} }],
      eventType: "syntra.jd.parsed",
      emitsOf: declared([["syntra.jd.process", ["syntra.jd.parsed"]]]),
    });
    expect(out).toBe("yes");
  });

  it("resolves an event a node declared through its settings", () => {
    const out = emitsEvent({
      nodes: [
        { id: "a", impl: "astra.route.decision", config: { onActionable: "x.y" } },
      ],
      eventType: "x.y",
      emitsOf: declared([["astra.route.decision", [{ fromConfig: "onActionable" }]]]),
    });
    expect(out).toBe("yes");
  });

  it("says NO when every step has declared and none publish it", () => {
    // The answer that was impossible before nodes declared. Every step here
    // has said what it publishes, so the absence is a fact rather than a gap,
    // and a chain built on it is provably broken.
    const out = emitsEvent({
      nodes: [
        { id: "a", impl: "syntra.jd.process", config: {} },
        { id: "b", impl: "syntra.shortlist.notify", config: {} },
      ],
      eventType: "syntra.jd.normalized",
      emitsOf: declared([
        ["syntra.jd.process", ["syntra.jd.parsed"]],
        ["syntra.shortlist.notify", []],
      ]),
    });
    expect(out).toBe("no");
  });

  it("says UNKNOWN when one step has not declared", () => {
    // One undeclared step is enough. It may publish the event from inside its
    // own code, and calling that "no" would block a chain that works.
    const out = emitsEvent({
      nodes: [
        { id: "a", impl: "syntra.jd.process", config: {} },
        { id: "b", impl: "astra.requirement.intake", config: {} },
      ],
      eventType: "syntra.jd.normalized",
      emitsOf: declared([["syntra.jd.process", ["syntra.jd.parsed"]]]),
    });
    expect(out).toBe("unknown");
  });

  it("keeps a declaration of nothing apart from no declaration", () => {
    // `[]` is an answer; null is the absence of one. The whole three-valued
    // result depends on those never being flattened together.
    const silent = emitsEvent({
      nodes: [{ id: "a", impl: "platform.human.gate", config: {} }],
      eventType: "any.event",
      emitsOf: declared([["platform.human.gate", []]]),
    });
    const undeclared = emitsEvent({
      nodes: [{ id: "a", impl: "platform.human.gate", config: {} }],
      eventType: "any.event",
      emitsOf: declared([["platform.human.gate", null]]),
    });
    expect(silent).toBe("no");
    expect(undeclared).toBe("unknown");
  });

  it("does not mistake an unrelated setting for a handoff", () => {
    const out = emitsEvent({
      nodes: [
        {
          id: "a",
          impl: "astra.route.decision",
          config: { onRejected: "astra.requirement.rejected" },
        },
      ],
      eventType: "syntra.jd.normalized",
      emitsOf: declared([]),
    });
    expect(out).toBe("unknown");
  });

  it("copes with a step that has no settings at all", () => {
    expect(
      emitsEvent({
        nodes: [{ id: "a", impl: "x" }],
        eventType: "any.event",
        emitsOf: declared([]),
      }),
    ).toBe("unknown");
  });
});

describe("detectTriggeredWorkflows", () => {
  /**
   * The live case. `syntra.jd.process` publishes `syntra.jd.parsed` from
   * inside its own code; that event is bound to `syntra.continuous.match`.
   */
  const emitsOf = new Map<string, EmitDeclaration[] | null>([
    ["syntra.jd.process", ["syntra.jd.parsed"]],
    ["syntra.continuous.match", ["syntra.match.completed"]],
    ["astra.requirement.intake", null],
  ]);
  const boundTo = new Map([
    ["syntra.jd.parsed", "syntra.continuous.match"],
  ]);
  const implsOf = new Map<string, readonly string[]>([
    ["syntra.continuous.match", ["syntra.continuous.match"]],
  ]);

  const run = (nodes: SplitStep[], over = {}) =>
    detectTriggeredWorkflows({ nodes, emitsOf, boundTo, implsOf, ...over });

  it("catches the same work running twice", () => {
    // One job, two sets of match results: once as this flow's own next step,
    // once in the workflow the previous step set going.
    const out = run([
      { id: "a", impl: "syntra.jd.process" },
      { id: "b", impl: "syntra.continuous.match" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.graphKey).toBe("syntra.continuous.match");
    expect(out[0]!.alsoRunsHere).toEqual(["syntra.continuous.match"]);
  });

  it("still reports a workflow it starts without duplicating", () => {
    // Starting another workflow is often the whole intention. It is reported
    // either way, because an author should know what their flow sets going.
    const out = run([{ id: "a", impl: "syntra.jd.process" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.alsoRunsHere).toEqual([]);
  });

  it("says nothing about an undeclared node", () => {
    // ASTRA has no contracts, so nothing is known about what its steps
    // publish. Treating that as "publishes nothing" is the exact error the
    // declaration was added to prevent.
    expect(run([{ id: "a", impl: "astra.requirement.intake" }])).toEqual([]);
  });

  it("ignores an event nothing is bound to", () => {
    // `syntra.match.completed` goes to a UI and an audit trail. No workflow
    // answers it, so nothing else runs.
    expect(run([{ id: "a", impl: "syntra.continuous.match" }])).toEqual([]);
  });

  it("does not report a workflow re-entering itself", () => {
    const out = run([{ id: "a", impl: "syntra.jd.process" }], {
      selfGraphKey: "syntra.continuous.match",
    });
    expect(out).toEqual([]);
  });

  it("reads an event carried in a step's settings", () => {
    // A `fromConfig` declaration: the node says WHERE the event name lives,
    // and the value comes from how this particular step was configured.
    const out = detectTriggeredWorkflows({
      nodes: [
        { id: "a", impl: "astra.route.decision", config: { onActionable: "syntra.jd.parsed" } },
      ],
      emitsOf: new Map<string, EmitDeclaration[] | null>([
        ["astra.route.decision", [{ fromConfig: "onActionable" }]],
      ]),
      boundTo,
      implsOf,
    });
    expect(out[0]!.eventType).toBe("syntra.jd.parsed");
  });

  it("declaring nothing is a real answer", () => {
    // `emits: []` means "publishes nothing", and is trusted as such — unlike
    // an absent declaration, which means nobody has said.
    const out = detectTriggeredWorkflows({
      nodes: [{ id: "a", impl: "syntra.duplicate.merge" }],
      emitsOf: new Map<string, EmitDeclaration[] | null>([
        ["syntra.duplicate.merge", []],
      ]),
      boundTo,
      implsOf,
    });
    expect(out).toEqual([]);
  });
});
