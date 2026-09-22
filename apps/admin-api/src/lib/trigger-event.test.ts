/**
 * The three shapes that exist in production, and what each should answer.
 */
import { describe, expect, it } from "vitest";
import { triggerEventFor } from "./trigger-event.js";

/**
 * `catalogue` is the event types the catalogue knows; `bound` is the event
 * the active binding points at this graph.
 */
function fakeDb(opts: { catalogue?: string[]; bound?: string | null }) {
  const seen: string[] = [];
  return {
    seen,
    query: async (text: string, params?: unknown[]) => {
      seen.push(text.replace(/\s+/g, " ").trim().slice(0, 40));
      if (/event_bindings/.test(text)) {
        return { rows: opts.bound ? [{ event_type: opts.bound }] : [] };
      }
      const asked = String((params ?? [])[0]);
      return { rows: (opts.catalogue ?? []).includes(asked) ? [{ "?column?": 1 }] : [] };
    },
  };
}

describe("triggerEventFor", () => {
  it("takes the declared trigger when it names a real event", async () => {
    const db = fakeDb({ catalogue: ["syntra.match.requested"], bound: "other.event" });
    const got = await triggerEventFor(db, {
      graphKey: "syntra.match.workflow",
      definition: { triggerEventType: "syntra.match.requested" },
    });
    expect(got).toBe("syntra.match.requested");
    // Settled without asking the bindings at all.
    expect(db.seen.some((q) => /event_bindings/.test(q))).toBe(false);
  });

  it("asks the binding when the definition declares nothing", async () => {
    // Eleven of the twelve live workflows.
    const db = fakeDb({ catalogue: [], bound: "syntra.match.requested" });
    const got = await triggerEventFor(db, {
      graphKey: "syntra.match.workflow",
      definition: { nodes: [], edges: [] },
    });
    expect(got).toBe("syntra.match.requested");
  });

  it("ignores a declared value the catalogue does not have", async () => {
    // `resume.intake` says entryInput: "ResumeReceivedPayload" — a payload TYPE
    // name, not an event type. Trusting it means looking up a schema that does
    // not exist and concluding the trigger carries nothing.
    const db = fakeDb({ catalogue: ["syntra.resume.received"], bound: "syntra.resume.received" });
    const got = await triggerEventFor(db, {
      graphKey: "resume.intake",
      definition: { entryInput: "ResumeReceivedPayload" },
    });
    expect(got).toBe("syntra.resume.received");
  });

  it("says null when neither the definition nor a binding knows", async () => {
    const db = fakeDb({ catalogue: [], bound: null });
    expect(
      await triggerEventFor(db, { graphKey: "nobody.workflow", definition: {} }),
    ).toBeNull();
  });

  it("reads entryInput when it does name a real event", async () => {
    const db = fakeDb({ catalogue: ["syntra.jd.received"], bound: null });
    expect(
      await triggerEventFor(db, {
        graphKey: "syntra.jd.workflow",
        definition: { entryInput: "syntra.jd.received" },
      }),
    ).toBe("syntra.jd.received");
  });
});
