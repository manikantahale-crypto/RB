/**
 * These pin the thing the registry exists to prevent.
 *
 * Ordering used to come from whatever sequence a model wrote, and the obvious
 * alternative — read the module out of the event name — is worse than no rule
 * at all, because it is confidently wrong in the one case that matters most.
 */
import { describe, expect, it } from "vitest";
import {
  MODULES,
  MODULE_REGISTRY,
  moduleEdges,
  moduleForFrontDoor,
  modulePublishing,
  orderModules,
} from "./module-registry.js";

describe("the registry covers what actually runs", () => {
  it("includes every module the live system has", () => {
    // orbit, relay and interview all run in production and were previously
    // unrepresentable — `module` could only be syntra, astra or platform.
    for (const key of ["astra", "syntra", "orbit", "relay", "interview", "platform"]) {
      expect(MODULES).toContain(key);
    }
  });

  it("gives every module a sentence about its domain, not its plumbing", () => {
    for (const m of MODULE_REGISTRY) {
      expect(m.owns.length).toBeGreaterThan(40);
      expect(m.title.length).toBeGreaterThan(3);
    }
  });

  it("keeps MODULES and the registry in step", () => {
    // MODULES is a hand-written tuple (z.enum needs literals) filled from the
    // registry at runtime. This is the only place the two could drift.
    expect([...MODULES]).toEqual(MODULE_REGISTRY.map((m) => m.key));
  });

  it("marks exactly one module as shared capability", () => {
    expect(MODULE_REGISTRY.filter((m) => m.shared).map((m) => m.key)).toEqual([
      "platform",
    ]);
  });
});

describe("the prefix is not the owner", () => {
  it("puts syntra.jd.received under ASTRA, which is what consumes it", () => {
    // The JD upload front door. Reading its prefix says SYNTRA acts first,
    // which is backwards: ASTRA gates the requirement and hands off after.
    expect(moduleForFrontDoor("syntra.jd.received")).toBe("astra");
    expect(modulePublishing("syntra.jd.received")).toBeNull();
  });

  it("puts syntra.jd.normalized under ASTRA as producer and SYNTRA as consumer", () => {
    expect(modulePublishing("syntra.jd.normalized")).toBe("astra");
    expect(moduleForFrontDoor("syntra.jd.normalized")).toBe("syntra");
  });
});

describe("moduleEdges", () => {
  it("derives the handoff ASTRA → SYNTRA from the event they share", () => {
    const edges = moduleEdges();
    expect(edges).toContainEqual({
      from: "astra",
      to: "syntra",
      via: "syntra.jd.normalized",
    });
  });

  it("never claims a module hands off to itself", () => {
    for (const e of moduleEdges()) expect(e.from).not.toBe(e.to);
  });

  it("only draws an edge where a published event is somebody's front door", () => {
    // astra.requirement.rejected is handed off but nothing takes it in as a
    // front door — it goes to a UI and an audit trail. No edge.
    expect(
      moduleEdges().some((e) => e.via === "astra.requirement.rejected"),
    ).toBe(false);
  });
});

describe("orderModules", () => {
  it("puts intake before matching however the request was written", () => {
    // The failure this exists for: a request naming SYNTRA first still plans
    // ASTRA first, because ASTRA's output is SYNTRA's input.
    expect(orderModules(["syntra", "astra"])).toEqual(["astra", "syntra"]);
    expect(orderModules(["astra", "syntra"])).toEqual(["astra", "syntra"]);
  });

  it("orders a three-application chain end to end", () => {
    expect(orderModules(["orbit", "syntra", "astra"])).toEqual([
      "astra",
      "syntra",
      "orbit",
    ]);
  });

  it("is stable — the same set always plans the same way", () => {
    const a = orderModules(["relay", "interview", "syntra", "astra"]);
    const b = orderModules(["astra", "syntra", "interview", "relay"]);
    expect(a).toEqual(b);
  });

  it("returns a single module unchanged", () => {
    expect(orderModules(["syntra"])).toEqual(["syntra"]);
  });

  it("ignores modules that are not asked for", () => {
    expect(orderModules(["syntra"])).not.toContain("astra");
  });

  it("places every module it was given, even with no edge between them", () => {
    const out = orderModules(["relay", "interview"]);
    expect(out.sort()).toEqual(["interview", "relay"]);
  });

  it("does not lose a module when applications talk both ways", () => {
    // A cycle must not throw and must not drop anyone: a planner that crashes
    // on a round trip is worse than one that returns a stable order.
    const cyclic = [
      { key: "a", title: "A", owns: "x".repeat(50), frontDoor: ["e.b"], handsOff: ["e.a"], shared: false },
      { key: "b", title: "B", owns: "y".repeat(50), frontDoor: ["e.a"], handsOff: ["e.b"], shared: false },
    ];
    const out = orderModules(["a", "b"], cyclic);
    expect(out.sort()).toEqual(["a", "b"]);
  });
});
