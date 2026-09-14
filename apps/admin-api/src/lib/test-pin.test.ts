/**
 * Making "Test" run the thing on screen.
 *
 * It did not. Screen 5 fires a real event, the router resolved the binding,
 * and a binding names the LIVE version — so testing an edit exercised the
 * version already in production, and a workflow that had never been live could
 * not be tried at all.
 */

import { describe, expect, it, vi } from "vitest";
import { pinForTest, queueForTest, type Queryable } from "./test-pin.js";

/**
 * A database that answers by matching the SQL, so each test states only the
 * rows it cares about. Anything unmatched comes back empty, which is what
 * "nothing bound / no draft / no version" looks like.
 */
const db = (answers: Array<[RegExp, Array<Record<string, unknown>>]>): Queryable => ({
  query: async (sql: string) => {
    for (const [pattern, rows] of answers) if (pattern.test(sql)) return { rows };
    return { rows: [] };
  },
});

const BOUND: [RegExp, Array<Record<string, unknown>>] = [
  /event_bindings/,
  [{ queue_key: "module.syntra.match" }],
];

describe("queueForTest", () => {
  it("uses the queue the active binding names", async () => {
    expect(await queueForTest(db([BOUND]), "syntra.match.workflow")).toBe(
      "module.syntra.match",
    );
  });

  it("falls back to a queue the application already serves", async () => {
    // The case this exists for: a workflow authored five minutes ago has no
    // binding, so there is no queue to inherit — and without one the job would
    // sit unclaimed with nothing to say why.
    const out = await queueForTest(
      db([[/platform\.queues/, [{ key: "module.syntra.jd" }]]]),
      "syntra.brand.new.workflow",
    );
    expect(out).toBe("module.syntra.jd");
  });

  it("returns null when nothing serves the application at all", async () => {
    expect(await queueForTest(db([]), "chrona.timesheet.workflow")).toBeNull();
  });
});

describe("pinForTest", () => {
  const compileDraft = vi.fn(async () => ({ version: 7, checksum: "sha-new" }));

  it("freezes the working copy and pins the run to it", async () => {
    const compile = vi.fn(async () => ({ version: 7, checksum: "sha-new" }));
    const out = await pinForTest(
      db([BOUND, [/graph_drafts/, [{ checksum: "sha-new" }]]]),
      { graphKey: "syntra.match.workflow", orgId: null, compileDraft: compile },
    );
    expect(out).toMatchObject({
      ok: true,
      compiled: true,
      version: 7,
      pin: {
        graphKey: "syntra.match.workflow",
        graphVersion: 7,
        moduleQueue: "module.syntra.match",
      },
    });
    expect(compile).toHaveBeenCalledOnce();
  });

  it("reuses the version when the draft has not moved", async () => {
    /*
     * Testing three times without editing should give one version, not three.
     * The checksum is what makes that decidable — a version with the same
     * checksum IS the draft, so minting a twin would only make the version
     * list unreadable.
     */
    const compile = vi.fn(async () => ({ version: 99, checksum: "never" }));
    const out = await pinForTest(
      db([
        BOUND,
        [/graph_drafts/, [{ checksum: "sha-same" }]],
        [/v\.checksum = \$3/, [{ version: 4 }]],
      ]),
      { graphKey: "syntra.match.workflow", orgId: null, compileDraft: compile },
    );
    expect(out).toMatchObject({ ok: true, compiled: false, version: 4 });
    expect(compile).not.toHaveBeenCalled();
  });

  it("tests the newest version when there is no working copy", async () => {
    // Nothing edited since the last freeze, so the newest version already IS
    // what is on screen. Compiling would produce an identical copy.
    const compile = vi.fn(async () => ({ version: 9, checksum: "x" }));
    const out = await pinForTest(
      db([BOUND, [/ORDER BY v\.version DESC/, [{ version: 3, checksum: "sha-3" }]]]),
      { graphKey: "syntra.match.workflow", orgId: null, compileDraft: compile },
    );
    expect(out).toMatchObject({ ok: true, compiled: false, version: 3 });
    expect(compile).not.toHaveBeenCalled();
  });

  it("refuses rather than pinning to a queue nobody works", async () => {
    /*
     * A job on an unserved queue does not fail — it waits for ever, which is
     * the hardest kind of nothing to debug. Saying so before firing is the
     * whole point.
     */
    const out = await pinForTest(db([]), {
      graphKey: "chrona.timesheet.workflow",
      orgId: null,
      compileDraft,
    });
    expect(out).toMatchObject({ ok: false, reason: "no_queue" });
    expect((out as { message: string }).message).toContain("unclaimed");
  });

  it("refuses when there is nothing to test at all", async () => {
    const out = await pinForTest(db([BOUND]), {
      graphKey: "syntra.match.workflow",
      orgId: null,
      compileDraft,
    });
    expect(out).toMatchObject({ ok: false, reason: "no_draft" });
  });

  it("says so when the draft is there but will not compile", async () => {
    const out = await pinForTest(
      db([BOUND, [/graph_drafts/, [{ checksum: "sha-new" }]]]),
      {
        graphKey: "syntra.match.workflow",
        orgId: null,
        compileDraft: async () => null,
      },
    );
    expect(out).toMatchObject({ ok: false, reason: "no_draft" });
  });
});
