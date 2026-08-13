import { createHash } from 'node:crypto';
import { z } from 'zod';
import { nodeRegistry } from '../nodes/registry.js';
import { assertKnownStateSchema } from './state.js';
import { entryInputSchemas } from '../contracts/payloads.js';

/** Inert topology stored in graph_definitions.definition (design §5.1). */
export const GraphDefinitionSchema = z.object({
  graphKey: z.string().min(1),
  agentName: z.string().min(1).optional(),
  stateSchema: z.string().min(1).optional(),
  entryInput: z.string().min(1).optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        impl: z.string().min(1),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
  edges: z.array(z.tuple([z.string(), z.string()])).min(1),
  conditionalEdges: z
    .array(
      z.object({
        from: z.string(),
        router: z.string(),
        map: z.record(z.string(), z.string()),
      }),
    )
    .optional(),
});

export type GraphDefinition = z.infer<typeof GraphDefinitionSchema>;

export type GraphSeed = {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'retired';
  definition: GraphDefinition;
  checksum: string;
};

export function checksumOf(definition: unknown): string {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

/** Static checks before compile (design §7). */
export function validateDefinition(def: GraphDefinition): void {
  assertKnownStateSchema(def.stateSchema);
  if (def.entryInput && !(def.entryInput in entryInputSchemas)) {
    throw new Error(
      `DEFINITION_INVALID: unknown entryInput "${def.entryInput}"`,
    );
  }

  const seenIds = new Set<string>();
  const nodeIds = new Set(def.nodes.map((n) => n.id));

  for (const node of def.nodes) {
    if (seenIds.has(node.id)) {
      throw new Error(`DEFINITION_INVALID: duplicate node id "${node.id}"`);
    }
    seenIds.add(node.id);
    if (!(node.impl in nodeRegistry)) {
      throw new Error(`DEFINITION_INVALID: unknown impl "${node.impl}"`);
    }
  }

  for (const [from, to] of def.edges) {
    for (const end of [from, to]) {
      if (end === '__start__' || end === '__end__') continue;
      if (!nodeIds.has(end)) {
        throw new Error(
          `DEFINITION_INVALID: edge endpoint "${end}" not in nodes`,
        );
      }
    }
  }

  if (!def.edges.some(([from]) => from === '__start__')) {
    throw new Error('DEFINITION_INVALID: no edge from __start__');
  }
  if (!def.edges.some(([, to]) => to === '__end__')) {
    throw new Error('DEFINITION_INVALID: nothing reaches __end__');
  }

  const onEdge = new Set<string>();
  for (const [from, to] of def.edges) {
    if (from !== '__start__' && from !== '__end__') onEdge.add(from);
    if (to !== '__start__' && to !== '__end__') onEdge.add(to);
  }
  for (const id of nodeIds) {
    if (!onEdge.has(id)) {
      throw new Error(`DEFINITION_INVALID: orphan node "${id}"`);
    }
  }

  const adj = new Map<string, string[]>();
  for (const [from, to] of def.edges) {
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  const reachable = new Set<string>(['__start__']);
  const queue = ['__start__'];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  for (const id of nodeIds) {
    if (!reachable.has(id)) {
      throw new Error(
        `DEFINITION_INVALID: node ${id} unreachable from __start__`,
      );
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
