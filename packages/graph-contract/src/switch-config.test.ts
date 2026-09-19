/**
 * The switch decides what the old project's two RELAY workflows relied on it
 * deciding. The presets are copied from there verbatim; these pin that they
 * still come to the same answers, and that a hand-written rule set behaves.
 */
import { describe, expect, it } from "vitest";
import {
  decideSwitch,
  evaluateCondition,
  resolveSwitchOutputLabels,
  resolveSwitchRules,
  switchConfigProblems,
} from "./switch-config.js";

describe("relay.email.route — is this email a requirement?", () => {
  const cfg = { preset: "relay.email.route" };

  it("a classified JD goes to path_jd", () => {
    expect(decideSwitch({ is_jd_intent: true }, cfg)).toEqual({ output: "path_jd", matchedRule: 0 });
    expect(decideSwitch({ reply_intent: "Requirement Shared" }, cfg).output).toBe("path_jd");
    expect(decideSwitch({ subject: "New REQUIREMENT: Java dev" }, cfg).output).toBe("path_jd");
    // altFields: the body is read when the subject says nothing
    expect(decideSwitch({ body: "sharing a requirement" }, cfg).output).toBe("path_jd");
  });

  it("anything else takes the default arm", () => {
    expect(decideSwitch({ reply_intent: "Interview Scheduled" }, cfg)).toEqual({
      output: "path_default",
      matchedRule: null,
    });
    expect(decideSwitch({}, cfg).output).toBe("path_default");
  });

  it("names both arms for the editor", () => {
    expect(resolveSwitchOutputLabels(cfg)).toEqual(["path_jd", "path_default"]);
  });
});

describe("relay.consent — what did the candidate say?", () => {
  const cfg = { preset: "relay.consent", maxReminders: 3 };

  it("yes, in any of its spellings", () => {
    for (const decision of ["approved", "yes", "true", "Approved", "YES"]) {
      expect(decideSwitch({ decision }, cfg).output).toBe("path_a_yes");
    }
    expect(decideSwitch({ human_decision: "approved" }, cfg).output).toBe("path_a_yes");
  });

  it("no", () => {
    expect(decideSwitch({ decision: "rejected" }, cfg).output).toBe("path_c_no");
    expect(decideSwitch({ decision: "no" }, cfg).output).toBe("path_c_no");
  });

  it("silence: remind while reminders are left, give up when they are not", () => {
    expect(decideSwitch({ decision: "timeout", reminder_count: 1 }, cfg).output).toBe("path_b_timeout");
    expect(decideSwitch({ decision: "timeout", reminder_count: 3 }, cfg).output).toBe("path_c_no");
    // maxReminders is the author's to set
    expect(
      decideSwitch({ decision: "timeout", reminder_count: 1 }, { ...cfg, maxReminders: 1 }).output,
    ).toBe("path_c_no");
  });

  it("nothing decided yet keeps waiting", () => {
    expect(decideSwitch({}, cfg).output).toBe("path_b_waiting");
    expect(decideSwitch({ decision: "maybe" }, cfg).output).toBe("path_b_waiting");
  });

  it("the stored config from the old project resolves to the same four arms", () => {
    // relay.consent.workflow v3, node "branch", as stored on the old project.
    const stored = {
      preset: "relay.consent",
      actionClass: "CONTROL",
      maxReminders: 3,
      defaultOutput: "path_b_waiting",
    };
    expect(resolveSwitchOutputLabels(stored).sort()).toEqual(
      ["path_a_yes", "path_b_timeout", "path_b_waiting", "path_c_no"].sort(),
    );
  });
});

describe("an author's own rules", () => {
  const cfg = {
    defaultOutput: "elsewhere",
    rules: [
      { output: "big", when: { field: "amount", op: "gte", value: 1000 } },
      { output: "urgent", when: { all: [{ field: "priority", op: "eq", value: "high" }, { field: "amount", op: "gt", value: 0 }] } },
      { output: "flagged", when: { any: [{ field: "flag", op: "exists" }, { field: "tags", op: "contains", value: "vip" }] } },
    ],
  };

  it("first rule that holds wins, in order", () => {
    expect(decideSwitch({ amount: 5000, priority: "high" }, cfg)).toEqual({ output: "big", matchedRule: 0 });
    expect(decideSwitch({ amount: 5, priority: "high" }, cfg).output).toBe("urgent");
    expect(decideSwitch({ amount: 5, priority: "low", flag: "x" }, cfg).output).toBe("flagged");
    expect(decideSwitch({ amount: 5 }, cfg)).toEqual({ output: "elsewhere", matchedRule: null });
  });

  it("explicit rules override a preset; the preset still fills the rest", () => {
    const r = resolveSwitchRules({ preset: "relay.email.route", rules: cfg.rules });
    expect(r.rules).toBe(cfg.rules);
    expect(r.defaultOutput).toBe("path_default");
    expect(r.fieldAliases).toEqual(["reply_intent"]);
  });

  it("no config at all means one arm, called default", () => {
    expect(resolveSwitchRules(undefined)).toEqual({ rules: [], defaultOutput: "default", fieldAliases: [] });
    expect(decideSwitch({ anything: 1 }, undefined).output).toBe("default");
  });
});

describe("operators", () => {
  const p = { n: "10", s: "Hello World", t: true, f: "0", empty: "", list: "a" };
  it.each([
    [{ field: "n", op: "gt", value: 9 }, true],
    [{ field: "n", op: "lte", value: 9 }, false],
    [{ field: "s", op: "contains", value: "world" }, true],
    [{ field: "s", op: "contains", value: "" }, false],
    [{ field: "s", op: "ne", value: "hello world" }, false],
    [{ field: "t", op: "true" }, true],
    [{ field: "f", op: "false" }, true],
    [{ field: "empty", op: "exists" }, false],
    [{ field: "missing", op: "exists" }, false],
    [{ field: "list", op: "nin", value: ["a", "b"] }, false],
    [{ field: "list", op: "in", value: "A" }, true],
  ] as const)("%o → %s", (cond, expected) => {
    expect(evaluateCondition(p, cond as never)).toBe(expected);
  });

  it("a global alias is read when the field is absent", () => {
    expect(evaluateCondition({ decision: "yes" }, { field: "human_decision", op: "eq", value: "yes" }, ["decision"])).toBe(true);
  });
});

describe("switchConfigProblems — what the editor tells the author", () => {
  it("accepts every preset and a well-formed rule set", () => {
    expect(switchConfigProblems({ preset: "relay.consent" })).toEqual([]);
    expect(switchConfigProblems({ rules: [{ output: "a", when: { field: "x", op: "eq", value: 1 } }] })).toEqual([]);
    expect(switchConfigProblems(undefined)).toEqual([]);
  });

  it("names the rule and the field that is wrong", () => {
    const problems = switchConfigProblems({
      rules: [{ output: "", when: { field: "x", op: "between", value: 1 } }],
    });
    expect(problems.some((p) => p.startsWith("rules.0.output"))).toBe(true);
    expect(problems.some((p) => p.includes("rules.0.when"))).toBe(true);
  });
});
