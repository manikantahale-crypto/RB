/**
 * orch.switch — pick a path by rules over the event, not by a score.
 *
 * `orch.branch.decision` decides on one number. This decides on anything the
 * payload says: "is it a requirement?", "did the candidate say yes?", "is the
 * amount over a thousand?". The rules are configuration on the step, so a
 * route changes without a code change, and the arms are whatever the rules
 * name.
 *
 * WHY IT IS A CONTRACT AND NOT AN ENGINE FUNCTION. This is the first node
 * that writes `branch_key` from a contract. The bridge (`from-contract.ts`)
 * carries a declared `branch_key` back to the graph state — the half of
 * T-112 that was missing — so a control node no longer has to live inside
 * the engine to be able to choose a path. `orch.branch.decision` can follow
 * the same way once its optional reject event is reconciled with `emits`.
 *
 * WHY IT EXISTS HERE AT ALL. The old project's `relay.intake.workflow` v3
 * and `relay.consent.workflow` v3 both use it (routing email by the
 * `relay.email.route` preset, branching consent by `relay.consent`), and
 * `V20260909.56` recorded it as the one step this repository could not
 * serve. RELAY's workflows come back at stage 6; this is what they need in
 * place first.
 *
 * The rules, the operators and the presets are `@tekisho/graph-contract`'s
 * — the one package both this node and the editor may read, so the two
 * cannot disagree about what a rule means.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";
import {
  SWITCH_PRESETS,
  SwitchRuleSchema,
  decideSwitch,
} from "@tekisho/graph-contract";

/* ─────────────────────────────── shapes ──────────────────────────────── */

/**
 * Whatever the event carries. A switch cannot know its fields in advance —
 * that is the point of it — so the input is the payload as a whole, and a
 * rule that names a missing field simply does not hold.
 */
const Input = z.object({}).passthrough();

const Output = z.object({
  /** The arm taken. What the router matches on. */
  branch_key: z.string().min(1),
  /** Which rule held, by position, or null when the default arm was taken. */
  matched_rule: z.number().int().min(0).nullable(),
  /** The preset in force, so the run record says which rule set decided. */
  preset: z.enum(SWITCH_PRESETS).nullable(),
});

/**
 * Design-time, frozen into the graph version. None of it is `adminExposed`:
 * a rule set is the SHAPE of the workflow — change one and an arm appears or
 * disappears — and structure belongs in the editor with a version behind it.
 * `maxReminders` is the one number a person might tune, and it is left with
 * the rules because it only means anything to one preset.
 */
const Config = z.object({
  preset: z.enum(SWITCH_PRESETS).optional(),
  rules: z.array(SwitchRuleSchema).optional(),
  defaultOutput: z.string().min(1).optional(),
  fieldAliases: z.array(z.string().min(1)).optional(),
  maxReminders: z.number().int().min(0).optional(),
});

/* ────────────────────────────── declaration ──────────────────────────── */

export const orchSwitch = defineNode({
  key: "orch.switch",
  version: "1.0.0",
  module: "platform",
  /** Every module's graphs need to be able to route on what an event says. */
  shareable: true,

  title: "Branch on a rule about the event",
  description:
    "Reads the event that started the run and sends the workflow down the first path whose rule holds — is this email a requirement, did the candidate say yes — or the default path when none does.",
  tags: ["control", "branch", "routing", "switch"],

  input: Input,
  output: Output,
  config: Config,

  /** Chooses a path. Control flow inside one run, visible to nobody outside it. */
  emits: [],
  sideEffect: "control",
  /** Same payload, same rules, same answer. Nothing is written. */
  idempotency: { strategy: "pure" },

  execution: {
    /** Comparisons on a payload already in memory. */
    timeoutMs: 5_000,
    retry: { limit: 0, backoff: "none", baseMs: 1 },
    classifyError: () => "permanent_input",
    locks: [],
  },

  dependencies: [],

  /**
   * Stored in full. "Why did this run go down path_c_no?" is answerable only
   * if the payload it read and the arm it chose are both on the run detail
   * page — and a routing payload is intents and flags, not a CV.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * The two presets the old project's workflows depend on, each arm at least
   * once, and a hand-written rule set — the same cases the shared evaluator
   * pins, seen through the node.
   */
  fixtures: [
    {
      name: "an email classified as a requirement goes to path_jd",
      input: { is_jd_intent: true, reply_intent: "Requirement Shared", thread_id: "t-1" },
      config: { preset: "relay.email.route" },
      expectedOutput: { branch_key: "path_jd", matched_rule: 0, preset: "relay.email.route" },
    },
    {
      name: "any other email takes the default path",
      input: { is_jd_intent: false, reply_intent: "Interview Scheduled" },
      config: { preset: "relay.email.route", defaultOutput: "path_default" },
      expectedOutput: { branch_key: "path_default", matched_rule: null, preset: "relay.email.route" },
    },
    {
      name: "a candidate who said yes",
      input: { decision: "approved", reminder_count: 0 },
      config: { preset: "relay.consent", maxReminders: 3 },
      expectedOutput: { branch_key: "path_a_yes", matched_rule: 0, preset: "relay.consent" },
    },
    {
      name: "silence with reminders left is a reminder, not a no",
      input: { decision: "timeout", reminder_count: 1 },
      config: { preset: "relay.consent", maxReminders: 3 },
      expectedOutput: { branch_key: "path_b_timeout", matched_rule: 3, preset: "relay.consent" },
    },
    {
      name: "silence after the last reminder is a no",
      input: { decision: "timeout", reminder_count: 3 },
      config: { preset: "relay.consent", maxReminders: 3 },
      expectedOutput: { branch_key: "path_c_no", matched_rule: 2, preset: "relay.consent" },
    },
    {
      name: "an author's own rules, first match wins",
      input: { amount: 1500, priority: "high" },
      config: {
        defaultOutput: "elsewhere",
        rules: [
          { output: "big", when: { field: "amount", op: "gte", value: 1000 } },
          { output: "urgent", when: { field: "priority", op: "eq", value: "high" } },
        ],
      },
      expectedOutput: { branch_key: "big", matched_rule: 0, preset: null },
    },
    {
      name: "no rule holds — the default arm",
      input: { amount: 5 },
      config: {
        defaultOutput: "elsewhere",
        rules: [{ output: "big", when: { field: "amount", op: "gte", value: 1000 } }],
      },
      expectedOutput: { branch_key: "elsewhere", matched_rule: null, preset: null },
    },
  ],

  run: async (ctx: NodeRunCtx, input, config) => {
    const { output, matchedRule } = decideSwitch(input, config);
    ctx.logger.info("orch.switch", {
      branch_key: output,
      matched_rule: matchedRule,
      preset: config.preset ?? null,
    });
    return {
      branch_key: output,
      matched_rule: matchedRule,
      preset: config.preset ?? null,
    };
  },
});
