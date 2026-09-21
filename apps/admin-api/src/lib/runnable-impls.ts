/**
 * What the worker can run, for the go-live gate: every contract key and
 * every declaration the worker composes (adapters/index.ts). One source,
 * the same one `materialize:nodes` writes to `node_registry` — so the
 * gate, the editor's palette and the runtime cannot disagree about which
 * steps exist.
 */
import { declaredNodes, nodeContracts } from "../../../../adapters/index.js";

export function runnableImpls(): string[] {
  return [...nodeContracts, ...declaredNodes].map((c) => c.key);
}
