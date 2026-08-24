/**
 * The routing entry
 *
 * A binding is a deterministic rule: which workflow answers which event, for
 * which tenants, in what order. Many bindings pointing at one workflow is
 * normal — a graph never knows which door fired.
 *
 * Two things a binding is NOT, and the schema makes both unrepresentable:
 *
 *   1. It carries no version. Bindings hold KEYS only; the active version is
 *      resolved at routing time and pinned onto the run. A version here would
 *      let a binding outlive the promotion that replaced it.
 *   2. Its conditions cannot inspect payload fields or compare thresholds.
 *      "Which process starts for this fact" is routing. "A decision inside a
 *      running process" is a branch in the graph. Mixing them puts business
 *      logic on the routing path, where no LLM and no judgement may live.
 */
import { z } from "zod";

/* ────────────────────────────── primitives ───────────────────────────── */

/** `syntra.jd.received`, `syntra.duplicate.review_required` */
const EventType = z
  .string()
  .regex(
    /^[a-z0-9]+(?:\.[a-z0-9_]+)+$/,
    "must look like `module.entity.past_tense_fact`",
  );

/** `requirement.post-intake` — the set of bindings that answer one event. */
const RoutingGroup = z
  .string()
  .regex(
    /^[a-z0-9]+(?:[.\-][a-z0-9]+)*$/,
    "must be lowercase words joined by dots or hyphens",
  );

const NonEmpty = z.string().min(1);

/* ──────────────────────────────── fields ─────────────────────────────── */

/**
 * `exclusive` — exactly one binding in this group may fire. Silent duplicate
 * work is the failure this closes.
 * `fanout` — every matching binding fires. Two modules answering the same
 * fact independently is normal and expected.
 */
export const RoutingModeSchema = z.enum(["exclusive", "fanout"]);
export type RoutingMode = z.infer<typeof RoutingModeSchema>;

/**
 * What happens when this route matches.
 *
 * `terminal` is a normal outcome, not a gap. Most events end somewhere — the
 * fact was recorded and nothing needs to run. CI checks that every event has
 * at least a terminal route precisely so "nothing happens" is stated on
 * purpose rather than left as an accident.
 */
export const TargetKindSchema = z.enum(["graph", "terminal", "resume", "fail"]);
export type TargetKind = z.infer<typeof TargetKindSchema>;

/**
 * Declarative, never code. `strictObject` is the point: adding
 * `{ minScore: 0.8 }` here is a Zod error, not a code review conversation.
 *
 * Entitlements only, for now. Event type is already matched by `event_type`.
 */
export const ConditionsSchema = z.strictObject({
  requires_entitlement: z.array(NonEmpty).default([]),
});

export const BindingStatusSchema = z.enum(["ACTIVE", "DRAFT", "RETIRED"]);
export type BindingStatus = z.infer<typeof BindingStatusSchema>;

/* ─────────────────────────────── the entry ───────────────────────────── */

const BindingBase = z.object({
  /** Stable id. Optional so a binding can be written in YAML before it exists. */
  id: NonEmpty.optional(),

  event_type: EventType,
  routing_group: RoutingGroup,
  mode: RoutingModeSchema,

  /**
   * Lower number wins. Within an exclusive group the lowest priority is the
   * one that fires; within a fanout group it only fixes the order, so the
   * result is stable rather than dependent on row order.
   *
   * CI enforces that priorities are unique inside a group.
   */
  priority: z.int(),

  conditions: ConditionsSchema.default({ requires_entitlement: [] }),

  /**
   * NULL = every tenant. Set = this tenant only, and it shadows the global
   * binding inside its own routing group. This is how a canary reaches one
   * customer without a second routing group existing.
   */
  org_id: NonEmpty.nullable().default(null),

  /**
   * Per-binding field adapter, applied when the job payload is built. Paths
   * are read from the event envelope: `payload_ref.requirement_id`.
   */
  input_mapping: z.record(NonEmpty, NonEmpty).optional(),

  status: BindingStatusSchema,
  /** Which module's team owns this rule. Drives CODEOWNERS review. */
  owner_module: NonEmpty,

  // NOTE: there is deliberately no `version` field. See the header.
});

/**
 * `workflow_key` and `module_queue` exist only on a graph target. A terminal
 * route pointing at a workflow is a contradiction, so it cannot be written.
 */
export const BindingEntrySchema = z
  .discriminatedUnion("target_kind", [
    BindingBase.extend({
      target_kind: z.literal("graph"),
      /** KEY only, never `key@version`. */
      workflow_key: NonEmpty,
      /** The pg-boss queue the router enqueues onto. */
      module_queue: NonEmpty,
    }),
    BindingBase.extend({ target_kind: z.literal("terminal") }),
    BindingBase.extend({ target_kind: z.literal("resume") }),
    BindingBase.extend({ target_kind: z.literal("fail") }),
  ])
  .superRefine((b, ctx) => {
    // A workflow key with a version pinned into it defeats the whole point.
    if ("workflow_key" in b && b.workflow_key.includes("@")) {
      ctx.addIssue({
        code: "custom",
        path: ["workflow_key"],
        message:
          "must be a key only — a binding never carries a version. The active version is resolved at routing time and pinned onto the run.",
      });
    }

    // The spec's own §6.4 example writes `payload.requirementId`, but the
    // envelope field is `payload_ref`. Left alone, that mapping silently
    // resolves to undefined. Catch it here with the correct path.
    for (const [target, path] of Object.entries(b.input_mapping ?? {})) {
      if (path === "payload" || path.startsWith("payload.")) {
        ctx.addIssue({
          code: "custom",
          path: ["input_mapping", target],
          message: `"${path}" — the envelope field is \`payload_ref\`, so write "${path.replace(
            /^payload/,
            "payload_ref",
          )}"`,
        });
      }
    }
  });

export type BindingEntry = z.infer<typeof BindingEntrySchema>;

/** Parse one entry, naming the binding and the field when it fails. */
export function parseBinding(input: unknown): BindingEntry {
  const parsed = BindingEntrySchema.safeParse(input);
  if (!parsed.success) {
    const where =
      input && typeof input === "object" && "event_type" in input
        ? String((input as { event_type: unknown }).event_type)
        : "<unknown binding>";
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(`BINDING_INVALID: ${where}\n${lines.join("\n")}`);
  }
  return parsed.data;
}