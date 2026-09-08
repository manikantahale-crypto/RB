/**
 * The routers a branch may use.
 *
 * These assertions are about the shape of the shared list. The one that
 * matters most — that the engine has a function for every key here — lives in
 * the orchestrator, because only that package can see the functions.
 */
import { describe, expect, it } from "vitest";
import { ROUTER_DEFINITIONS, ROUTER_KEYS, routerDefinition } from "./routers.js";

describe("ROUTER_DEFINITIONS", () => {
  it("has no duplicate keys", () => {
    expect(new Set(ROUTER_KEYS).size).toBe(ROUTER_KEYS.length);
  });

  it("gives every router at least two outcomes", () => {
    // A router with one outcome is not a branch — it is an edge with extra
    // steps, and the editor would draw a fork that forks nowhere.
    for (const r of ROUTER_DEFINITIONS) {
      expect(r.outcomes.length).toBeGreaterThan(1);
    }
  });

  it("has no duplicate outcomes within a router", () => {
    // Two arms with the same name means the second is unreachable: the map
    // from outcome to target is keyed by the name.
    for (const r of ROUTER_DEFINITIONS) {
      expect(new Set(r.outcomes).size).toBe(r.outcomes.length);
    }
  });

  it("only lets the router with a decision step rename its outcomes", () => {
    // The others return fixed strings from engine code, so an outcome an
    // author invented is an arm that can never run.
    for (const r of ROUTER_DEFINITIONS) {
      if (r.customOutcomes) expect(r.decisionImpl).not.toBeNull();
    }
  });

  it("finds a router by key, and does not invent one", () => {
    expect(routerDefinition("branch_key")?.decisionImpl).toBe(
      "orch.branch.decision",
    );
    expect(routerDefinition("nope")).toBeUndefined();
  });
});
