/**
 * Every node contract, in one list.
 *
 * Two places need it and they need different things from it:
 *
 *   apps/worker      composes them into the runtime registry so graphs can run
 *   apps/admin-api   runs ONE of them for the editor's node test
 *
 * Exported from here rather than from the worker so that reading a contract
 * does not drag the whole engine along with it. A contract depends only on
 * `@tekisho/node-contract` and its own HTTP helper; the engine is a runtime
 * concern, and the admin API has no business importing it to inspect a
 * declaration.
 *
 * Adding a node is one import and one line — in this file, once.
 */
import { jdProcess } from "./syntra/nodes/jd-process.node.js";
import { resumeProcess } from "./syntra/nodes/resume-process.node.js";
import { matchProcess } from "./syntra/nodes/match-process.node.js";
import { continuousMatch } from "./syntra/nodes/continuous-match.node.js";
import { duplicateDetect } from "./syntra/nodes/duplicate-detect.node.js";
import { benchAlert } from "./syntra/nodes/bench-alert.node.js";
import { shortlistNotify } from "./syntra/nodes/shortlist-notify.node.js";
import { duplicateMerge } from "./syntra/nodes/duplicate-merge.node.js";
import { runRetry } from "./syntra/nodes/run-retry.node.js";
import { humanGate } from "./platform/nodes/human-gate.node.js";
import { branchDecision } from "./platform/nodes/branch-decision.node.js";
import { orchSwitch } from "./platform/nodes/orch-switch.node.js";

/** Contracts the worker composes into the runtime. These RUN. */
export const nodeContracts = [
  jdProcess,
  resumeProcess,
  matchProcess,
  continuousMatch,
  duplicateDetect,
  benchAlert,
  shortlistNotify,
  duplicateMerge,
  runRetry,
  /**
   * The first control node to run from a contract. The bridge now carries a
   * declared `branch_key` back to the graph state, which is what kept the
   * two below out of this list.
   */
  orchSwitch,
];

/**
 * Declarations that are NOT composed into the runtime.
 *
 * Two platform control nodes describe themselves here while the engine keeps
 * running them: `human.gate` parks a run by calling `interrupt()`, and
 * `orch.branch.decision` writes `state.branch_key`. Neither of those can travel
 * back through the contract bridge, which returns `{ result }` and nothing
 * else — so composing them would break them silently. Each file says so at the
 * top.
 *
 * They are declared anyway because `node_registry` is materialized from
 * declarations and every admin screen is a projection of that table. Without
 * this list both nodes land as legacy rows with `shareable = false`, which is
 * why no module's palette could offer a branch or a human gate, and why the
 * editor briefly hardcoded the branch's thresholds.
 *
 * WHAT IS TRUE OF THESE AND NOT OF `nodeContracts`: the declaration is not
 * enforced. Nothing checks the schemas against the code that actually runs, so
 * they can drift. Rows written from this list are marked `source = 'declared'`
 * rather than `'contract'` so the screens can say so rather than imply a
 * guarantee that is not there.
 *
 * Half of that is now done: the bridge carries `branch_key` (see
 * `orch.switch` above). What still keeps `orch.branch.decision` here is its
 * optional `onRejectEvent`, which publishes an event its `emits: []` does not
 * declare; `human.gate` parks a run by calling `interrupt()`, which no
 * contract can express yet.
 */
export const declaredNodes = [humanGate, branchDecision];

export type NodeContractEntry = (typeof nodeContracts)[number];
export type DeclaredNodeEntry = (typeof declaredNodes)[number];
