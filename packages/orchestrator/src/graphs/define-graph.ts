import { createHash } from 'node:crypto';
import { GraphDefinitionSchema, type GraphDefinition } from './definition.js';
import { validateDefinition } from './validate-definition.js';

export type GraphSeed = {
  /** Stable primary key in graph_definitions.id */
  id: string;
  version: number;
  status: 'draft' | 'active' | 'retired';
  definition: GraphDefinition;
  checksum: string;
};

/** SHA-256 of the definition JSON (stored in graph_definitions.checksum). */
export function checksumOf(definition: unknown): string {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

/**
 * Author a graph recipe in git (design §8).
 * Parses with Zod and runs static checks against the node registry.
 */
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
