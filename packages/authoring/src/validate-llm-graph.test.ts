/**
 * The generator's list of routers must match the contract's.
 *
 * There were three hand-written lists of the same four routers: the engine's
 * `ROUTER_REGISTRY`, the editor's `ROUTERS`, and this one — which decides
 * whether a graph the model proposes is accepted at all. The comment in
 * `graph-edit.ts` used to ask people to keep them in sync by hand.
 *
 * Two now derive from `@tekisho/graph-contract`. This one stays a literal
 * tuple on purpose: `RouterKey` is a union used for narrowing, and deriving it
 * would widen it to `string` and lose that. So it is written out and guarded,
 * which is exactly what `MODULES` does in the node contract for the same
 * reason.
 *
 * If this test fails, a router was added to the contract and not here — and
 * the generator would reject a branch the engine can run perfectly well.
 */
import { describe, expect, it } from "vitest";
import { ROUTER_KEYS } from "@tekisho/graph-contract";
import { ALLOWED_ROUTER_KEYS } from "./validate-llm-graph.js";

describe("ALLOWED_ROUTER_KEYS", () => {
  it("matches the contract, exactly and in order", () => {
    expect([...ALLOWED_ROUTER_KEYS]).toEqual([...ROUTER_KEYS]);
  });

  it("accepts nothing the contract does not name", () => {
    // The reverse direction: a key here that the engine has no function for
    // means the generator can produce a graph that fails at compile with
    // DEFINITION_INVALID, after the author has already accepted it.
    for (const k of ALLOWED_ROUTER_KEYS) {
      expect(ROUTER_KEYS).toContain(k);
    }
  });
});
