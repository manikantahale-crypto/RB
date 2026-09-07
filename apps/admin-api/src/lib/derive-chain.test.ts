/**
 * Recovering a chain from what is already stored.
 *
 * The fixture is the real ASTRA → SYNTRA pair: `astra.route.decision` carries
 * `onActionable: "syntra.jd.normalized"` in its config, and that event starts
 * `syntra.authored`. Written from the definitions rather than the live database
 * on purpose — that binding was retired at some point during this work, and a
 * test that goes quiet when production changes is not a test.
 */
import { describe, expect, it } from "vitest";
import { deriveChain, type GraphSummary } from "./derive-chain.js";

const astra: GraphSummary = {
  graphKey: "astra.requirement.workflow",
  definition: {
    nodes: [
      { config: { actionClass: "DATA_SHAPING" } },
      { config: { passMin: 0.6, onRejectEvent: "astra.requirement.rejected" } },
      {
        config: {
          actionClass: "CONTROL",
          onActionable: "syntra.jd.normalized",
          onRejected: "astra.requirement.rejected",
        },
      },
    ],
  },
};
const syntra: GraphSummary = {
  graphKey: "syntra.authored",
  definition: { nodes: [{ config: {} }] },
};

const bindings = [
  { eventType: "astra.requirement.received", graphKey: "astra.requirement.workflow" },
  { eventType: "syntra.jd.normalized", graphKey: "syntra.authored" },
];

const chainFor = (graphKey: string, over = {}) =>
  deriveChain({ graphKey, graphs: [astra, syntra], bindings, ...over });

describe("deriveChain", () => {
  it("finds what a workflow hands off to", () => {
    const out = chainFor("astra.requirement.workflow");
    expect(out.downstream).toEqual([
      { graphKey: "syntra.authored", via: "syntra.jd.normalized" },
    ]);
    expect(out.upstream).toEqual([]);
  });

  it("finds what hands off to a workflow", () => {
    const out = chainFor("syntra.authored");
    expect(out.upstream).toEqual([
      { graphKey: "astra.requirement.workflow", via: "syntra.jd.normalized" },
    ]);
    expect(out.downstream).toEqual([]);
  });

  it("ignores an event nothing is bound to", () => {
    // `astra.requirement.rejected` is a real event that goes to a UI and an
    // audit trail. No workflow answers it, so there is no neighbour to draw.
    const out = chainFor("astra.requirement.workflow");
    expect(out.downstream.map((d) => d.via)).not.toContain(
      "astra.requirement.rejected",
    );
  });

  it("does not draw a workflow as its own neighbour", () => {
    const selfish: GraphSummary = {
      graphKey: "loop.workflow",
      definition: { nodes: [{ config: { next: "loop.again" } }] },
    };
    const out = deriveChain({
      graphKey: "loop.workflow",
      graphs: [selfish],
      bindings: [{ eventType: "loop.again", graphKey: "loop.workflow" }],
    });
    // Re-entering itself is a loop, not a chain link. Drawing it as a
    // neighbour would be a lie about what happens.
    expect(out.downstream).toEqual([]);
  });

  it("reports nothing when the binding between them is gone", () => {
    // Exactly what happened to this pair mid-session: the binding was retired,
    // so ASTRA still emits and nothing listens. The chain is genuinely broken
    // and the honest answer is "no neighbour", not a stale one.
    const out = deriveChain({
      graphKey: "astra.requirement.workflow",
      graphs: [astra, syntra],
      bindings: [bindings[0]!],
    });
    expect(out.downstream).toEqual([]);
  });

  it("copes with a workflow that is not in the list", () => {
    const out = chainFor("nothing.here");
    expect(out).toEqual({
      graphKey: "nothing.here",
      upstream: [],
      downstream: [],
    });
  });
});

describe("a chain that has only just been accepted", () => {
  /** Two drafts, no bindings — the trigger lives in each definition. */
  const upstreamDraft: GraphSummary = {
    graphKey: "astra.intake.authored",
    definition: {
      entryInput: "astra.requirement.received",
      nodes: [{ config: { onActionable: "syntra.astra.handoff" } }],
    },
  };
  const downstreamDraft: GraphSummary = {
    graphKey: "syntra.match.authored",
    definition: { entryInput: "syntra.astra.handoff", nodes: [{ config: {} }] },
  };

  it("links them before either has gone live", () => {
    // A strip that appeared only after go-live would be missing at exactly the
    // moment somebody is checking what they just accepted.
    const out = deriveChain({
      graphKey: "astra.intake.authored",
      graphs: [upstreamDraft, downstreamDraft],
      bindings: [],
    });
    expect(out.downstream).toEqual([
      { graphKey: "syntra.match.authored", via: "syntra.astra.handoff" },
    ]);
  });

  it("reads the same chain from the other end", () => {
    const out = deriveChain({
      graphKey: "syntra.match.authored",
      graphs: [upstreamDraft, downstreamDraft],
      bindings: [],
    });
    expect(out.upstream).toEqual([
      { graphKey: "astra.intake.authored", via: "syntra.astra.handoff" },
    ]);
  });

  it("lets a live binding win over a draft claiming the same event", () => {
    // Two drafts can both name an event as their trigger. What actually
    // happens is decided by the binding, so that is the stronger claim.
    const rival: GraphSummary = {
      graphKey: "other.draft",
      definition: { entryInput: "syntra.astra.handoff", nodes: [] },
    };
    const out = deriveChain({
      graphKey: "astra.intake.authored",
      graphs: [upstreamDraft, downstreamDraft, rival],
      bindings: [
        { eventType: "syntra.astra.handoff", graphKey: "other.draft" },
      ],
    });
    expect(out.downstream).toEqual([
      { graphKey: "other.draft", via: "syntra.astra.handoff" },
    ]);
  });
});
