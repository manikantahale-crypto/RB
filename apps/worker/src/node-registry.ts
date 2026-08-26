/**
 * The composition root for nodes.
 *
 * This is the ONLY place that imports both the engine and the module adapters.
 * The engine defines what a registry is; it must never know what a JD is, so
 * it cannot import `adapters/`. The adapters describe capabilities; they must
 * never own a retry queue, so they cannot import the engine. This file is
 * where the two meet, and it is deliberately dull.
 *
 * Why it matters in production:
 *   - a module ships a new node without an engine release
 *   - one module's broken adapter cannot take routing down for the others
 *   - a worker process can be given only the nodes it serves, so per-module
 *     workers become a deployment choice rather than a rewrite
 *   - CI can compose a registry of stubs without mocking imports
 *
 * As each node is converted it moves from `nodeRegistry` into
 * the block below. When `nodeRegistry` is empty, delete it.
 */
import {
  nodeRegistry,
  type NodeRegistry,
} from '@tekisho/orchestrator/src/nodes/registry.js';
import { toNodeImpl } from '@tekisho/orchestrator/src/nodes/from-contract.js';
import { nodeContracts } from '../../../adapters/index.js';

/**
 * Nodes that have been moved to a contract.
 *
 * The list lives in `adapters/index.ts` because the admin API needs it too —
 * for the editor's node test — and it has no business importing the engine to
 * get at a declaration.
 *
 * Adding a module's node is one line there — no engine change, no release from
 * the platform team.
 */
export const contractNodes = nodeContracts;

export function composeNodeRegistry(): NodeRegistry {
  const composed: Record<string, NodeRegistry[string]> = { ...nodeRegistry };

  for (const contract of contractNodes) {
    const impl = toNodeImpl(contract);
    composed[contract.key] = () => impl;
  }

  return composed;
}

/** For the boot log — which nodes came from where. */
export function describeNodeRegistry(): string {
  const fromContract = contractNodes.map((c) => c.key);
  const builtIn = Object.keys(nodeRegistry).filter(
    (k) => !fromContract.includes(k),
  );
  return `${fromContract.length} from contracts (${fromContract.join(', ')}), ${builtIn.length} built in`;
}