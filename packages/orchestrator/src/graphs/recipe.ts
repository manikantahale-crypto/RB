import { nodeRegistry } from '../nodes/registry.js';
import { assertKnownStateSchema } from './state.js';
import { entryInputSchemas } from '../contracts/payloads.js';
import {
  GraphDefinitionSchema,
  validateGraphTopology,
  checksumOf,
  type GraphDefinition,
} from '@tekisho/graph-contract';

export {
  GraphDefinitionSchema,
  validateGraphTopology,
  checksumOf,
  type GraphDefinition,
};

export type GraphSeed = {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'retired';
  definition: GraphDefinition;
  checksum: string;
};

/** Static checks before compile (design §7) — topology + runtime registry. */
export function validateDefinition(def: GraphDefinition): void {
  validateGraphTopology(def);

  assertKnownStateSchema(def.stateSchema);
  if (def.entryInput && !(def.entryInput in entryInputSchemas)) {
    throw new Error(
      `DEFINITION_INVALID: unknown entryInput "${def.entryInput}"`,
    );
  }

  for (const node of def.nodes) {
    if (!(node.impl in nodeRegistry)) {
      throw new Error(`DEFINITION_INVALID: unknown impl "${node.impl}"`);
    }
  }
}

/** Author a recipe in git; worker seeds it into graph_definitions (design §8). */
export function defineGraph(
  def: GraphDefinition,
  meta: { id: string; version?: number; status?: GraphSeed['status'] },
): GraphSeed {
  const parsed = GraphDefinitionSchema.parse(def);
  validateDefinition(parsed);
  return {
    id: meta.id,
    version: meta.version ?? 1,
    status: meta.status ?? 'active',
    definition: parsed,
    checksum: checksumOf(parsed),
  };
}
