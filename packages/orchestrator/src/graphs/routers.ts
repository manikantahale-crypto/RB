import type { SyntraGraphState } from '../nodes/types.js';

/**
 * Conditional-edge router functions used by the compiler.
 * Each router receives the current graph state and returns a string key
 * that must match one of the map entries in the conditionalEdges definition.
 *
 * Allowed keys (kept in sync with authoring validate-llm-graph):
 *   - branch_key (ASTRA quality gate: pass | human_review | reject)
 *   - result.approved_or_end
 *   - result.continue_or_gate
 *   - result.has_duplicate_or_end
 */

export type RouterFn = (state: SyntraGraphState) => string;

/**
 * ASTRA / orch.branch.decision — routes on state.branch_key.
 */
function branchKeyRouter(state: SyntraGraphState): string {
  const key = String(state.branch_key ?? 'reject');
  return key;
}

/**
 * "approved_or_end": routes "approved" when state.result contains "approved",
 * otherwise routes "rejected".
 */
function approvedOrEnd(state: SyntraGraphState): string {
  const r = String(state.result ?? '').toLowerCase();
  if (r.includes('approved')) return 'approved';
  return 'rejected';
}

/**
 * "continue_or_gate": routes "continued" when the workflow was resumed from
 * a human.gate interrupt (result contains "human.gate:resumed:"), otherwise
 * routes "gate" to re-enter the gate node.
 */
function continueOrGate(state: SyntraGraphState): string {
  const r = String(state.result ?? '');
  if (r.includes('human.gate:resumed:')) return 'continued';
  return 'gate';
}

/**
 * "has_duplicate_or_end": routes "duplicate_found" when the result signals a
 * duplicate was detected, otherwise routes "no_duplicate".
 */
function hasDuplicateOrEnd(state: SyntraGraphState): string {
  const r = String(state.result ?? '').toLowerCase();
  if (r.includes('duplicate') || r.includes('review_required')) {
    return 'duplicate_found';
  }
  return 'no_duplicate';
}

export const ROUTER_REGISTRY: Record<string, RouterFn> = {
  branch_key: branchKeyRouter,
  'result.approved_or_end': approvedOrEnd,
  'result.continue_or_gate': continueOrGate,
  'result.has_duplicate_or_end': hasDuplicateOrEnd,
};
