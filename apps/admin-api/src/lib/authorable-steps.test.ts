/**
 * The filter that stopped screen 2 building SYNTRA workflows out of ASTRA.
 *
 * Reproduced before this existed: "keep matching bench consultants against a
 * new requirement" produced `astra.requirement.intake → syntra.continuous.match`.
 * Both keys resolve at run time, so the run would have gone green having
 * matched nobody.
 */

import { describe, expect, it } from "vitest";
import {
  AUTHORABLE_SOURCES,
  authorableSourcesSql,
  isAuthorableStep,
} from "./authorable-steps.js";

describe("isAuthorableStep", () => {
  it("admits a step declared through a contract", () => {
    expect(isAuthorableStep({ source: "contract" })).toBe(true);
  });

  it("admits the platform's own declared steps", () => {
    // human.gate and orch.branch.decision. Without these a workflow cannot
    // pause for a person, which is most of the point of the gate.
    expect(isAuthorableStep({ source: "declared" })).toBe(true);
  });

  it("refuses an undeclared step", () => {
    // Every ASTRA and ORBIT row in this project. They stay in the registry
    // because the graphs already using them still run.
    expect(isAuthorableStep({ source: "legacy" })).toBe(false);
  });

  it("refuses a row whose source is missing or unrecognised", () => {
    /*
     * Deny by default. A source nobody has taught this rule about is one
     * nobody has checked can hand work to a contract step, and admitting it
     * would reintroduce the failure quietly - which is how it got here.
     */
    expect(isAuthorableStep({})).toBe(false);
    expect(isAuthorableStep({ source: null })).toBe(false);
    expect(isAuthorableStep({ source: "something-new" })).toBe(false);
  });
});

describe("authorableSourcesSql", () => {
  it("quotes every source for an IN list", () => {
    expect(authorableSourcesSql()).toBe("'contract', 'declared'");
  });

  it("stays in step with the list the filter uses", () => {
    // The whole reason this module exists: one rule, two call sites, and no
    // way for them to drift apart without a test going red.
    for (const source of AUTHORABLE_SOURCES) {
      expect(isAuthorableStep({ source })).toBe(true);
      expect(authorableSourcesSql()).toContain(`'${source}'`);
    }
  });
});
