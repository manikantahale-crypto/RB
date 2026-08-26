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
];

export type NodeContractEntry = (typeof nodeContracts)[number];
