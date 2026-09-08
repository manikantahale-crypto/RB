/**
 * The routers a branch may use, named once.
 *
 * A router decides which arm of a branch runs. Its NAME and its OUTCOMES have
 * to be known in two places that cannot import each other:
 *
 *   - the engine, which holds the function that does the deciding
 *     (`packages/orchestrator/src/graphs/routers.ts`)
 *   - the editor, which offers the choice and draws an arm per outcome
 *     (`apps/admin/src/lib/graph-edit.ts`)
 *
 * Both used to keep their own hand-written list. Two lists of the same four
 * things, maintained by hand, in packages owned by different people — the only
 * question was when they would disagree, not whether. A router added to the
 * editor but not the engine offers an author a branch that fails at compile
 * with `DEFINITION_INVALID: unknown conditional router`; added to the engine
 * but not the editor, it simply cannot be reached.
 *
 * So the shared half lives here, in the contract both sides already depend on.
 * Each side still adds what only it can know: the engine attaches the function,
 * the editor attaches the label and the sentence explaining the choice.
 *
 * ADDING A ROUTER: add it below, add its function to `ROUTER_REGISTRY`, and add
 * its label to `ROUTERS`. A test in the orchestrator fails if you do the first
 * without the second.
 */

export type RouterOutcome = string;

export type RouterDefinition = {
  /** Matches `conditionalEdges[].router` in a stored definition. */
  key: string;
  /** The arms this router can return. Every one needs somewhere to go. */
  outcomes: readonly RouterOutcome[];
  /**
   * A step this router needs in front of it, if any.
   *
   * `branch_key` reads `state.branch_key`, which only exists because a decision
   * node wrote it — so choosing that router means inserting one. The others
   * read `state.result`, which every step leaves behind, so they add nothing.
   */
  decisionImpl: string | null;
  /**
   * Whether an author may rename or add outcomes.
   *
   * True only for `branch_key`: its decision node takes the outcome names as
   * configuration, so the arms are the author's to choose. The others return
   * fixed strings from engine code, and an outcome the function never returns
   * is an arm that can never run.
   */
  customOutcomes: boolean;
};

export const ROUTER_DEFINITIONS: readonly RouterDefinition[] = [
  {
    key: "branch_key",
    outcomes: ["pass", "human_review", "reject"],
    decisionImpl: "orch.branch.decision",
    customOutcomes: true,
  },
  {
    key: "result.approved_or_end",
    outcomes: ["approved", "rejected"],
    decisionImpl: null,
    customOutcomes: false,
  },
  {
    key: "result.continue_or_gate",
    outcomes: ["continued", "gate"],
    decisionImpl: null,
    customOutcomes: false,
  },
  {
    key: "result.has_duplicate_or_end",
    outcomes: ["duplicate_found", "no_duplicate"],
    decisionImpl: null,
    customOutcomes: false,
  },
];

export const ROUTER_KEYS: readonly string[] = ROUTER_DEFINITIONS.map(
  (r) => r.key,
);

export function routerDefinition(key: string): RouterDefinition | undefined {
  return ROUTER_DEFINITIONS.find((r) => r.key === key);
}
