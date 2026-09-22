/**
 * The two things this layer is responsible for: reading the declarations out
 * of the right columns, and never being the reason a save fails.
 */
import { describe, expect, it } from "vitest";
import { inferInputsForGraph } from "./infer-inputs-for-graph.js";

/** `node_registry` and the event catalogue, answering the two real queries. */
function fakeDb(opts: {
  registry?: any[];
  trigger?: any;
  /** The event the active binding points at this graph. */
  bound?: string | null;
  throwOn?: RegExp;
}) {
  const seen: string[] = [];
  return {
    seen,
    query: async (text: string) => {
      seen.push(text);
      if (opts.throwOn?.test(text)) throw new Error("registry unreachable");
      if (/node_registry/.test(text)) return { rows: opts.registry ?? [] };
      if (/event_bindings/.test(text)) {
        return { rows: opts.bound ? [{ event_type: opts.bound }] : [] };
      }
      return { rows: opts.trigger ? [{ payload_schema: opts.trigger }] : [] };
    },
  };
}

const REGISTRY = [
  {
    key: "relay.consent.send",
    input_schema: { properties: { jobId: {}, top_candidates: {} } },
    output_schema: { properties: { jobId: {}, consent_threads: {} } },
  },
  {
    key: "relay.consent.remind",
    input_schema: { properties: { thread_id: {}, consent_threads: {} } },
    output_schema: { properties: { threadId: {} } },
  },
];

const DEF = {
  graphKey: "relay.consent.workflow",
  triggerEventType: "syntra.match.completed",
  nodes: [
    { id: "send", impl: "relay.consent.send" },
    { id: "remind", impl: "relay.consent.remind" },
  ],
  edges: [
    ["__start__", "send"],
    ["send", "remind"],
    ["remind", "__end__"],
  ],
};

describe("inferInputsForGraph", () => {
  it("fills the map from what the registry says the nodes declare", async () => {
    const db = fakeDb({
      registry: REGISTRY,
      trigger: { properties: { jobId: {}, top_candidates: {} } },
    });
    const { definition, wired } = await inferInputsForGraph(db, DEF, "relay.consent.workflow");

    const remind = (definition as any).nodes.find((n: any) => n.id === "remind");
    expect(remind.inputs).toEqual({ consent_threads: "send.consent_threads" });
    // `jobId` is on the trigger, so it is not mapped — the trigger payload
    // reaches every step on its own.
    expect(wired.map((w) => w.field)).toEqual(["consent_threads"]);
  });

  it("finds the trigger through the binding when the definition declares none", async () => {
    // Eleven of the twelve live workflows are this shape. Without the binding
    // the trigger fields are empty, and inference maps a field that was going
    // to arrive on the trigger anyway.
    const db = fakeDb({
      registry: REGISTRY,
      bound: "syntra.match.completed",
      trigger: { properties: { consent_threads: {} } },
    });
    const bare = structuredClone(DEF) as any;
    delete bare.triggerEventType;
    const { wired } = await inferInputsForGraph(db, bare, "relay.consent.workflow");
    expect(wired).toHaveLength(0);
  });

  it("returns the definition untouched when the registry cannot be read", async () => {
    const db = fakeDb({ throwOn: /node_registry/ });
    const { definition, wired } = await inferInputsForGraph(db, DEF, "relay.consent.workflow");
    expect(definition).toBe(DEF);
    expect(wired).toEqual([]);
  });

  it("does not query at all for a definition with no steps", async () => {
    const db = fakeDb({ registry: REGISTRY });
    const out = await inferInputsForGraph(db, { graphKey: "x", nodes: [], edges: [] }, "x");
    expect(db.seen).toHaveLength(0);
    expect(out.wired).toEqual([]);
  });

  it("leaves a map somebody wrote alone", async () => {
    const db = fakeDb({ registry: REGISTRY, trigger: { properties: {} } });
    const def = structuredClone(DEF) as any;
    def.nodes[1].inputs = { consent_threads: "trigger.previous_threads" };
    const { definition } = await inferInputsForGraph(db, def, "relay.consent.workflow");
    expect(
      (definition as any).nodes.find((n: any) => n.id === "remind").inputs
        .consent_threads,
    ).toBe("trigger.previous_threads");
  });
});
