/**
 * When a plan may be released, and what it says when it may not.
 *
 * These four rules are the product decision the plans table exists to hold, so
 * they are tested directly rather than through a route. `canRelease` is pure
 * for that reason.
 */

import { describe, expect, it } from "vitest";
import { canRelease, type StoredPlan, type StoredStep } from "./plans.js";

const step = (over: Partial<StoredStep> = {}): StoredStep => ({
  seq: 1,
  kind: "new",
  graphKey: "syntra.jd.workflow",
  inboundEventType: null,
  blockedReason: null,
  ownerApplication: null,
  approvedAt: null,
  ...over,
});

const plan = (over: Partial<StoredPlan> = {}): StoredPlan => ({
  id: "11111111-1111-1111-1111-111111111111",
  status: "pending_approval",
  requestText: "match resumes to open requirements",
  requestedBy: "22222222-2222-2222-2222-222222222222",
  approvedBy: "33333333-3333-3333-3333-333333333333",
  steps: [step()],
  ...over,
});

describe("canRelease", () => {
  it("releases an approved plan with one new step", () => {
    const v = canRelease(plan());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.willRelease).toEqual([1]);
  });

  it("refuses a plan nobody has approved", () => {
    // A proposal, not a release. The message has to say who is missing,
    // because "not approved" reads like a bug to the person who just asked.
    const v = canRelease(plan({ approvedBy: null }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/somebody other than the person who asked/);
  });

  it("refuses while any step is blocked, and says which", () => {
    // Releasing "the rest" leaves a chain with a hole in it: a workflow bound
    // to an event that nothing in the plan will ever publish.
    const v = canRelease(
      plan({
        steps: [
          step({ seq: 1 }),
          step({
            seq: 2,
            kind: "blocked",
            graphKey: null,
            blockedReason: "no event carries work from step 1",
          }),
        ],
      }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toContain("step 2");
      expect(v.reason).toContain("no event carries work from step 1");
    }
  });

  it("refuses until another application's owner has approved their step", () => {
    // The first place the entitlement model does real work. ORBIT's owner
    // decides what ORBIT runs, whoever wrote the sentence.
    const v = canRelease(
      plan({ steps: [step({ seq: 1, ownerApplication: "orbit" })] }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("orbit");
  });

  it("releases once that owner has approved", () => {
    const v = canRelease(
      plan({
        steps: [
          step({
            seq: 1,
            ownerApplication: "orbit",
            approvedAt: "2026-09-11T00:00:00Z",
          }),
        ],
      }),
    );
    expect(v.ok).toBe(true);
  });

  it("refuses a plan that would change nothing", () => {
    // Every step already exists and runs. Recording a release here would put
    // a row in the history claiming something changed when nothing did.
    const v = canRelease(plan({ steps: [step({ kind: "existing" })] }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/nothing\s+to release|already exists/);
  });

  it("refuses to release the same plan twice", () => {
    const v = canRelease(plan({ status: "live" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/already been released/);
  });

  it("refuses an abandoned plan rather than reviving it", () => {
    const v = canRelease(plan({ status: "abandoned" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/abandoned/);
  });

  it("releases changed steps as well as new ones, and not existing ones", () => {
    const v = canRelease(
      plan({
        steps: [
          step({ seq: 1, kind: "existing" }),
          step({ seq: 2, kind: "changed" }),
          step({ seq: 3, kind: "new" }),
        ],
      }),
    );
    expect(v.ok).toBe(true);
    // An `existing` step is in the plan so the chain reads as a whole. It
    // releases nothing, and including it would retire a live version to
    // promote the same definition again.
    if (v.ok) expect(v.willRelease).toEqual([2, 3]);
  });
});
