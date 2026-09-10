/**
 * A retry must run the version it started on.
 *
 * That guarantee used to live in `public.orchestration_job_pins`, a table
 * whose only job was to remember a fact the run already recorded. These tests
 * pin the guarantee itself, so it survives the table going away.
 */

import { describe, expect, it } from "vitest";
import { resolveDurablePin } from "./version-pin.js";

const ORG = "11111111-1111-1111-1111-111111111111";
const JOB = "job-abc";

function fakeDb(prior: { graph_key: string; graph_version: number } | null) {
  const statements: string[] = [];
  return {
    statements,
    query: async (text: string, params?: unknown[]) => {
      statements.push(text.trim().split("\n")[0]!.trim());
      if (/FROM orch\.runs/i.test(text)) {
        // The composed thread id is the job identity. If this stops matching,
        // every retry silently re-resolves and the pin means nothing.
        expect(params?.[0]).toBe(`${ORG}:${JOB}`);
        return { rows: prior ? [prior] : [], rowCount: prior ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const resolve = (
  db: ReturnType<typeof fakeDb>,
  over: Record<string, unknown> = {},
  activeVersion = 9,
) =>
  resolveDurablePin(db as never, {
    bossJobId: JOB,
    graphKey: "syntra.jd.workflow",
    organizationId: ORG,
    resolveActiveVersion: async () => activeVersion,
    ...over,
  });

describe("resolveDurablePin", () => {
  it("takes the payload stamp over everything else", async () => {
    // The relay decided at enqueue. Nothing downstream gets to disagree,
    // including a previous attempt.
    const db = fakeDb({ graph_key: "syntra.jd.workflow", graph_version: 3 });
    const pin = await resolve(db, {
      payloadPin: { graphKey: "other.workflow", graphVersion: 5 },
    });
    expect(pin).toEqual({ graphKey: "other.workflow", graphVersion: 5 });
    // It should not even have looked.
    expect(db.statements.some((q) => /orch\.runs/i.test(q))).toBe(false);
  });

  it("reuses the version a previous attempt ran", async () => {
    // The whole point: version 4 went live between attempt one and this retry,
    // and the retry still runs 3.
    const db = fakeDb({ graph_key: "syntra.jd.workflow", graph_version: 3 });
    await expect(resolve(db, {}, 4)).resolves.toEqual({
      graphKey: "syntra.jd.workflow",
      graphVersion: 3,
    });
  });

  it("keeps the graph key the earlier attempt used, not the one passed in", async () => {
    // A job pinned to a key is pinned to that key. Taking the argument here
    // would let a retry run a different workflow than the attempt it resumes.
    const db = fakeDb({ graph_key: "was.this.one", graph_version: 2 });
    const pin = await resolve(db);
    expect(pin.graphKey).toBe("was.this.one");
  });

  it("resolves what is live when this is the first attempt", async () => {
    const db = fakeDb(null);
    await expect(resolve(db, {}, 7)).resolves.toEqual({
      graphKey: "syntra.jd.workflow",
      graphVersion: 7,
    });
  });

  it("ignores a payload stamp that is not a usable number", async () => {
    // NaN and undefined both mean "nobody stamped this", and both used to slip
    // through a truthiness check into the pin row.
    const db = fakeDb(null);
    await expect(
      resolve(db, { payloadPin: { graphVersion: Number.NaN } }, 7),
    ).resolves.toEqual({ graphKey: "syntra.jd.workflow", graphVersion: 7 });
  });

  it("never writes anything", async () => {
    // The pin is a read now. A write here would be a second copy of the fact
    // the run already holds, which is what was removed.
    const db = fakeDb(null);
    await resolve(db);
    expect(
      db.statements.some((q) => /^(INSERT|UPDATE|DELETE)/i.test(q)),
    ).toBe(false);
  });
});
