/**
 * orch.branch.decision — a DECLARATION, not an implementation.
 *
 * WHY THIS FILE DOES NOT RUN ANYTHING.
 *
 * The live implementation is `packages/orchestrator/src/nodes/branch.ts`, and
 * it stays there for now. This node's whole job is to write `state.branch_key`,
 * which the compiler's conditional edges read — and the contract bridge
 * (`from-contract.ts`) ends with `return { result: ... }`. It carries a node's
 * output back as a breadcrumb and nothing else.
 *
 * So composing this contract into the runtime would compute the decision, drop
 * it on the floor, and leave the router falling back to
 * `state.branch_key ?? 'reject'` — every run silently taking the reject path,
 * with no error and no failed run. That is the exact failure this codebase has
 * spent a week removing, so it is not being introduced deliberately.
 *
 * WHAT IT IS FOR. `node_registry` is materialized from declarations, and the
 * admin screens are projections of that table: the editor's settings panel
 * renders `config`, the palette filter reads `module` and `shareable`, screen
 * 2's ranking reads `description`. Without a declaration this node has none of
 * those — which is why its thresholds were briefly hardcoded in the admin UI,
 * and why no module's palette could offer it at all.
 *
 * THE COST, NAMED. A declaration can drift from the implementation it
 * describes, because nothing checks one against the other. Every field below
 * is copied from `branch.ts`; if you change that file, change this one.
 *
 * This is temporary. When outcomes become part of the node contract (T-112),
 * the bridge can carry them, and this becomes a real contract in
 * `nodeContracts` with `run` wired to the live implementation.
 */
import { z } from "zod";
import { defineNode, type NodeRunCtx } from "@tekisho/node-contract";

/* ─────────────────────────────── shapes ──────────────────────────────── */

/**
 * Read from the trigger payload. Both are optional because the node has
 * defaults for both — a missing score reads as 0, which rejects, and a missing
 * actionable flag reads as true.
 *
 * That first default is worth knowing about: a graph that branches on a score
 * the publisher stopped sending rejects everything, quietly.
 */
const Input = z.object({
  confidence_score: z.number().optional(),
  is_actionable: z.boolean().optional(),
  /** Set when a human gate resumed the run; overrides the score outright. */
  human_decision: z.union([z.boolean(), z.string()]).optional(),
});

/** What the decision comes to. `branch_key` is what the router matches on. */
const Output = z.object({
  /**
   * Not an enum. A graph may name its own paths through `outcomes`, so the
   * set of values this can take is decided per graph rather than here —
   * declaring three would make every fourth path look invalid.
   */
  branch_key: z.string().min(1),
  /** The number the decision was made on, so a person can check it. */
  score: z.number(),
});

/**
 * Design-time values, frozen into the graph version.
 *
 * The two thresholds are `adminExposed`: where the line sits between accept,
 * ask-a-person and reject is a business judgement that differs per customer,
 * and moving it changes no structure. `field` and `actionableField` are NOT
 * exposed — they name payload keys, so a wrong value does not misjudge a
 * requirement, it silently reads `undefined` and rejects everything.
 */
const Config = z.object({
  field: z.string().min(1).default("confidence_score"),
  /**
   * The paths this branch decides between, and the score each one needs.
   *
   * Omit it and the three defaults below apply, which is what every existing
   * graph relies on. Supply it and these are the whole story: the highest band
   * a score reaches wins, and the lowest is the catch-all.
   *
   * Not adminExposed — adding or removing a path changes the SHAPE of the
   * workflow, and structure belongs in the editor with a version behind it,
   * not in a per-org settings form.
   */
  outcomes: z
    .array(
      z.object({
        name: z.string().min(1),
        min: z.number(),
      }),
    )
    .optional(),
  actionableField: z.string().min(1).default("is_actionable"),
  passMin: z
    .number()
    .min(0)
    .max(1)
    .default(0.6)
    .meta({ adminExposed: true, label: "Pass at or above" }),
  humanMin: z
    .number()
    .min(0)
    .max(1)
    .default(0.35)
    .meta({ adminExposed: true, label: "Ask a person at or above" }),
  requireHuman: z
    .boolean()
    .default(false)
    .meta({ adminExposed: true, label: "Always ask a person" }),
  /** Emitted when the decision is reject, so another workflow can react. */
  onRejectEvent: z.string().optional(),
});

/* ────────────────────────────── declaration ──────────────────────────── */

export const branchDecision = defineNode({
  key: "orch.branch.decision",
  version: "1.0.0",
  module: "platform",
  /** Every module's graphs need to be able to split on a judgement. */
  shareable: true,

  title: "Branch on a confidence score",
  description:
    "Reads a score from the event and sends the workflow down one of several paths — by default carry on, ask a person, or stop, and a graph may name its own.",
  tags: ["control", "branch", "routing"],

  input: Input,
  output: Output,
  config: Config,

  /**
   * `control` — it changes no business data. It decides which way the run
   * goes, and optionally emits one event saying it rejected. Orchestration,
   * not meaning.
   */
  sideEffect: "control",

  /**
   * `pure` is legal because `control` writes nothing. Re-running the same
   * decision on the same payload reaches the same answer; the optional reject
   * event is emitted through the outbox, which de-duplicates on its own.
   */
  idempotency: { strategy: "pure" },

  execution: {
    /** Arithmetic on a payload already in memory. */
    timeoutMs: 5_000,
    /**
     * limit 0 — there is nothing to retry. The only way this throws is a
     * missing trigger event, and that is the same on the second attempt.
     */
    retry: { limit: 0, backoff: "none", baseMs: 1 },
    classifyError: () => "permanent_input",
    locks: [],
  },

  /** Reads memory, writes nothing, calls nothing. */
  dependencies: [],

  /**
   * Both stored in full, and this is the point of the node. "Why did this run
   * go to a human?" is answerable only if the score it saw and the branch it
   * chose are both on the run detail page. Neither is PII — a number and the
   * name of a path.
   */
  persistence: {
    storeInput: "full",
    storeOutput: "full",
    redactPaths: [],
  },

  /**
   * Every default arm, plus a graph that names its own. A branch which
   * silently always takes one path is the failure that matters — and it is a
   * failure this exact node has had.
   */
  fixtures: [
    {
      name: "a confident score carries on",
      input: { confidence_score: 0.82, is_actionable: true },
      config: {
        field: "confidence_score",
        actionableField: "is_actionable",
        passMin: 0.6,
        humanMin: 0.35,
        requireHuman: false,
      },
      expectedOutput: { branch_key: "pass", score: 0.82 },
    },
    {
      name: "a middling score asks a person",
      input: { confidence_score: 0.44, is_actionable: true },
      config: {
        field: "confidence_score",
        actionableField: "is_actionable",
        passMin: 0.6,
        humanMin: 0.35,
        requireHuman: false,
      },
      expectedOutput: { branch_key: "human_review", score: 0.44 },
    },
    {
      name: "a graph's own paths, with more than three of them",
      input: { confidence_score: 0.72, is_actionable: true },
      config: {
        field: "confidence_score",
        actionableField: "is_actionable",
        passMin: 0.6,
        humanMin: 0.35,
        requireHuman: false,
        outcomes: [
          { name: "auto_send", min: 0.9 },
          { name: "review", min: 0.5 },
          { name: "escalate", min: 0.2 },
          { name: "drop", min: 0 },
        ],
      },
      expectedOutput: { branch_key: "review", score: 0.72 },
    },
    {
      name: "not actionable is rejected whatever the score says",
      input: { confidence_score: 0.91, is_actionable: false },
      config: {
        field: "confidence_score",
        actionableField: "is_actionable",
        passMin: 0.6,
        humanMin: 0.35,
        requireHuman: false,
      },
      expectedOutput: { branch_key: "reject", score: 0.91 },
    },
  ],

  /**
   * Never called. This declaration is not composed into the runtime — see the
   * note at the top of the file — and throwing is how that stays true: if
   * somebody adds it to `nodeContracts` by mistake, the first branching run
   * fails loudly instead of quietly rejecting everything.
   */
  run: async (ctx: NodeRunCtx) => {
    ctx.logger.error(
      "orch.branch.decision: declaration only — the live implementation is packages/orchestrator/src/nodes/branch.ts",
    );
    throw new Error(
      "orch.branch.decision is a declaration, not an implementation. It must not be in nodeContracts.",
    );
  },
});
