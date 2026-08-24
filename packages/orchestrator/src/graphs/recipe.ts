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

  // The "does this impl exist?" check deliberately does NOT happen here.
  //
  // Seed recipes are validated at module load, before any registry has been
  // composed — and the real registry is assembled by the worker
  // from the engine's own nodes plus the module adapters. Checking against the
  // engine's list alone would reject every node that has been moved to a
  // contract.
  //
  // GraphCompiler does the check instead, against the registry it was actually
  // given, and names the missing impl.
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
