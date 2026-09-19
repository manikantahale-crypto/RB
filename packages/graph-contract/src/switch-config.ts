/**
 * What an `orch.switch` step decides on, named once.
 *
 * A switch reads the event that started the run and picks a path by rule —
 * "if `is_jd_intent` is true go to `path_jd`, otherwise `path_default`". The
 * rules are configuration on the step, so an author changes a route without a
 * code change, and the same rules have to be read in two places that cannot
 * import each other: the node that decides (adapters/platform) and the editor
 * that lets a person write them (apps/admin). So the shape, the operators,
 * the presets and the evaluation live here, in the contract both depend on.
 *
 * Ported from the `orch-all-agents-fanout` branch (its
 * `packages/graph-contract/src/switch-config.ts`, 2026-09-03) where two live
 * RELAY workflows use it: `relay.intake.workflow` v3 routes email by the
 * `relay.email.route` preset, `relay.consent.workflow` v3 branches a
 * candidate's answer by `relay.consent`. Those definitions are copied here
 * verbatim as the presets so the same stored graphs run unchanged.
 *
 * Every comparison is case-insensitive on strings, because these values come
 * out of email subjects and human decisions, and "Approved" is "approved".
 */
import { z } from "zod";

export const SWITCH_OPS = [
  "eq",
  "ne",
  "in",
  "nin",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
  "true",
  "false",
] as const;

export type SwitchOp = (typeof SWITCH_OPS)[number];

export const SwitchConditionSchema = z.object({
  /** The payload key to read. */
  field: z.string().min(1),
  op: z.enum(SWITCH_OPS),
  /** Compared against; unused by exists / true / false. */
  value: z.unknown().optional(),
  /** Other keys to try when `field` is absent from the payload. */
  altFields: z.array(z.string().min(1)).optional(),
});
export type SwitchCondition = z.infer<typeof SwitchConditionSchema>;

export const SwitchWhenSchema = z.union([
  z.object({ all: z.array(SwitchConditionSchema).min(1) }),
  z.object({ any: z.array(SwitchConditionSchema).min(1) }),
  SwitchConditionSchema,
]);
export type SwitchWhen = z.infer<typeof SwitchWhenSchema>;

export const SwitchRuleSchema = z.object({
  /** The arm taken when `when` holds. Must be a key in the step's conditionalEdges map. */
  output: z.string().min(1),
  when: SwitchWhenSchema,
});
export type SwitchRule = z.infer<typeof SwitchRuleSchema>;

export const SWITCH_PRESETS = ["relay.consent", "relay.email.route"] as const;
export type SwitchPreset = (typeof SWITCH_PRESETS)[number];

/** The step's config as stored in a definition. Everything is optional. */
export const SwitchNodeConfigSchema = z.object({
  /** A built-in rule set. Explicit `rules` override it; the rest fills in. */
  preset: z.enum(SWITCH_PRESETS).optional(),
  /** First rule that holds wins. */
  rules: z.array(SwitchRuleSchema).optional(),
  /** The arm taken when no rule holds. */
  defaultOutput: z.string().min(1).optional(),
  /** Keys tried for EVERY condition whose own field is absent. */
  fieldAliases: z.array(z.string().min(1)).optional(),
  /** `relay.consent` only: reminders before a silent candidate is a no. */
  maxReminders: z.number().int().min(0).optional(),
});
export type SwitchNodeConfig = z.infer<typeof SwitchNodeConfigSchema>;

export type ResolvedSwitch = {
  rules: SwitchRule[];
  defaultOutput: string;
  fieldAliases: string[];
};

/* ────────────────────────────── presets ─────────────────────────────── */

/**
 * A candidate answered a consent email, or did not.
 *
 * yes → path_a_yes · no → path_c_no · timed out with reminders left →
 * path_b_timeout · timed out with none left → path_c_no · anything else →
 * path_b_waiting. `decision` is what the gate resumed with; `human_decision`
 * is the older name for the same thing and is read as an alias.
 */
export function consentSwitchPreset(maxReminders = 3): ResolvedSwitch {
  return {
    fieldAliases: ["decision", "human_decision"],
    defaultOutput: "path_b_waiting",
    rules: [
      {
        output: "path_a_yes",
        when: {
          any: [
            { field: "decision", op: "in", value: ["approved", "yes", "true"] },
            { field: "human_decision", op: "in", value: ["approved", "yes", "true"] },
          ],
        },
      },
      {
        output: "path_c_no",
        when: {
          any: [
            { field: "decision", op: "in", value: ["rejected", "no", "false"] },
            { field: "human_decision", op: "in", value: ["rejected", "no", "false"] },
          ],
        },
      },
      {
        output: "path_c_no",
        when: {
          all: [
            { field: "decision", op: "eq", value: "timeout", altFields: ["human_decision"] },
            { field: "reminder_count", op: "gte", value: maxReminders },
          ],
        },
      },
      {
        output: "path_b_timeout",
        when: {
          all: [
            { field: "decision", op: "eq", value: "timeout", altFields: ["human_decision"] },
            { field: "reminder_count", op: "lt", value: maxReminders },
          ],
        },
      },
    ],
  };
}

/** An email the inbox classified: is it a requirement, or anything else? */
export function emailRouteSwitchPreset(): ResolvedSwitch {
  return {
    fieldAliases: ["reply_intent"],
    defaultOutput: "path_default",
    rules: [
      {
        output: "path_jd",
        when: {
          any: [
            { field: "is_jd_intent", op: "true" },
            { field: "reply_intent", op: "eq", value: "Requirement Shared" },
            { field: "subject", op: "contains", value: "requirement", altFields: ["body"] },
          ],
        },
      },
    ],
  };
}

/** What a step's config comes to, preset and overrides combined. */
export function resolveSwitchRules(
  config: SwitchNodeConfig | Record<string, unknown> | undefined,
): ResolvedSwitch {
  const cfg = (config ?? {}) as SwitchNodeConfig;
  const own = Array.isArray(cfg.rules) && cfg.rules.length > 0 ? cfg.rules : null;

  const preset =
    cfg.preset === "relay.consent"
      ? consentSwitchPreset(typeof cfg.maxReminders === "number" ? cfg.maxReminders : 3)
      : cfg.preset === "relay.email.route"
        ? emailRouteSwitchPreset()
        : null;

  if (preset) {
    return {
      rules: own ?? preset.rules,
      defaultOutput: cfg.defaultOutput ?? preset.defaultOutput,
      fieldAliases: cfg.fieldAliases ?? preset.fieldAliases,
    };
  }
  return {
    rules: own ?? [],
    defaultOutput: cfg.defaultOutput ?? "default",
    fieldAliases: cfg.fieldAliases ?? [],
  };
}

/** Every arm this step can take — what the editor draws and the gate checks. */
export function resolveSwitchOutputLabels(
  config: SwitchNodeConfig | Record<string, unknown> | undefined,
): string[] {
  const { rules, defaultOutput } = resolveSwitchRules(config);
  const labels = new Set<string>();
  for (const rule of rules) labels.add(rule.output);
  labels.add(defaultOutput);
  return [...labels];
}

/* ───────────────────────────── evaluation ───────────────────────────── */

function readField(
  payload: Record<string, unknown>,
  field: string,
  alternatives: string[],
): unknown {
  for (const key of [field, ...alternatives]) {
    const v = payload[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

const lower = (v: unknown) => String(v ?? "").toLowerCase();

export function evaluateCondition(
  payload: Record<string, unknown>,
  cond: SwitchCondition,
  fieldAliases: string[] = [],
): boolean {
  const alternatives = [
    ...(cond.altFields ?? []),
    ...fieldAliases.filter((a) => a !== cond.field),
  ];
  const raw = readField(payload, cond.field, alternatives);

  switch (cond.op) {
    case "exists":
      return raw !== undefined && raw !== "";
    case "true":
      return raw === true || raw === "true" || raw === 1 || raw === "1";
    case "false":
      return raw === false || raw === "false" || raw === 0 || raw === "0";
    case "contains": {
      const needle = lower(cond.value);
      return needle.length > 0 && lower(raw).includes(needle);
    }
    case "in":
    case "nin": {
      const values = (Array.isArray(cond.value) ? cond.value : [cond.value]).map(lower);
      const hit = values.includes(lower(raw));
      return cond.op === "in" ? hit : !hit;
    }
    case "eq":
      return lower(raw) === lower(cond.value);
    case "ne":
      return lower(raw) !== lower(cond.value);
    case "gt":
      return Number(raw) > Number(cond.value);
    case "gte":
      return Number(raw) >= Number(cond.value);
    case "lt":
      return Number(raw) < Number(cond.value);
    case "lte":
      return Number(raw) <= Number(cond.value);
  }
}

export function evaluateWhen(
  payload: Record<string, unknown>,
  when: SwitchWhen,
  fieldAliases: string[] = [],
): boolean {
  if ("all" in when) return when.all.every((c) => evaluateCondition(payload, c, fieldAliases));
  if ("any" in when) return when.any.some((c) => evaluateCondition(payload, c, fieldAliases));
  return evaluateCondition(payload, when, fieldAliases);
}

/**
 * The decision. First rule that holds names the arm; none → the default.
 * `matchedRule` is the index for the run record, or null for the default.
 */
export function decideSwitch(
  payload: Record<string, unknown>,
  config: SwitchNodeConfig | Record<string, unknown> | undefined,
): { output: string; matchedRule: number | null } {
  const { rules, defaultOutput, fieldAliases } = resolveSwitchRules(config);
  for (const [i, rule] of rules.entries()) {
    if (evaluateWhen(payload, rule.when, fieldAliases)) {
      return { output: rule.output, matchedRule: i };
    }
  }
  return { output: defaultOutput, matchedRule: null };
}

/**
 * Says what is wrong with a step's config, in the author's words, or nothing.
 * The zod schema is the source; this turns its issues into one sentence each.
 */
export function switchConfigProblems(config: unknown): string[] {
  const parsed = SwitchNodeConfigSchema.safeParse(config ?? {});
  if (parsed.success) return [];
  return parsed.error.issues.map(
    (i) => `${i.path.length ? i.path.join(".") : "config"}: ${i.message}`,
  );
}
