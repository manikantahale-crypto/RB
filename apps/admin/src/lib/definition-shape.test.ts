/**
 * The shapes that reached the editor from the database, not invented ones.
 *
 * `orbit.lifecycle.workflow` v9 is the case that mattered: status `live`,
 * definition `{}`. Opening it threw during render and the error boundary
 * replaced the whole Builder with "Something went wrong".
 */

import { describe, expect, it } from "vitest";
import { isWellFormed, usableDefinition } from "./definition-shape";

describe("isWellFormed", () => {
  it("accepts a real definition", () => {
    expect(
      isWellFormed({
        graphKey: "syntra.jd.workflow",
        nodes: [{ id: "process", impl: "syntra.jd.process" }],
        edges: [["__start__", "process"]],
      }),
    ).toBe(true);
  });

  it("accepts an empty but well-formed workflow", () => {
    // A workflow with no steps yet is fine. The arrays are what matter.
    expect(isWellFormed({ graphKey: "k", nodes: [], edges: [] })).toBe(true);
  });

  it("rejects the row that crashed the editor", () => {
    expect(isWellFormed({})).toBe(false);
  });

  it("rejects half a definition", () => {
    expect(isWellFormed({ nodes: [] })).toBe(false);
    expect(isWellFormed({ edges: [] })).toBe(false);
  });

  it("rejects nothing at all", () => {
    expect(isWellFormed(null)).toBe(false);
    expect(isWellFormed(undefined)).toBe(false);
  });

  it("rejects the right keys holding the wrong types", () => {
    // jsonb will store any of these, so the check is on the type, not presence.
    expect(isWellFormed({ nodes: {}, edges: [] })).toBe(false);
    expect(isWellFormed({ nodes: [], edges: "none" })).toBe(false);
  });
});

describe("usableDefinition", () => {
  it("gives arrays for the row that crashed the editor", () => {
    const d = usableDefinition({});
    expect(d.nodes).toEqual([]);
    expect(d.edges).toEqual([]);
    // The original failure, exactly: reading [0] off undefined.
    expect(d.nodes[0]?.id ?? null).toBeNull();
  });

  it("survives null and undefined", () => {
    for (const input of [null, undefined]) {
      const d = usableDefinition(input);
      expect(d.nodes).toEqual([]);
      expect(d.edges).toEqual([]);
    }
  });

  it("leaves a real definition alone", () => {
    const real = {
      graphKey: "syntra.jd.workflow",
      entryInput: "syntra.jd.received",
      nodes: [{ id: "process", impl: "syntra.jd.process" }],
      edges: [["__start__", "process"]] as Array<[string, string]>,
    };
    expect(usableDefinition(real)).toEqual(real);
  });

  it("keeps every other field, including ones it does not know about", () => {
    // conditionalEdges and anything a later version adds must survive, or
    // opening and saving a branching workflow would silently drop its arms.
    const d = usableDefinition({
      graphKey: "k",
      conditionalEdges: [{ from: "a", router: "r", map: { yes: "b" } }],
      somethingNewer: 42,
    });
    expect(d.conditionalEdges).toHaveLength(1);
    expect((d as Record<string, unknown>).somethingNewer).toBe(42);
    expect(d.nodes).toEqual([]);
  });

  it("repairs only the half that is wrong", () => {
    const d = usableDefinition({
      graphKey: "k",
      nodes: [{ id: "one", impl: "x" }],
    });
    expect(d.nodes).toHaveLength(1);
    expect(d.edges).toEqual([]);
  });
});
