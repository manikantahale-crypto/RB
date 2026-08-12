import { z } from "zod";

/**
 * Same shape as runtime GraphDefinitionSchema (orchestrator definition.ts).
 * Kept in authoring so Stage 1 does not import the worker package.
 */
export const GraphDefinitionSchema = z.object({
  graphKey: z.string().min(1),
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

/** Structural checks (no nodeRegistry — that is Stage 2 Compile). */
export function validateGraphTopology(def: GraphDefinition): void {
  const seenIds = new Set<string>();
  for (const node of def.nodes) {
    if (seenIds.has(node.id)) {
      throw new Error(`DEFINITION_INVALID: duplicate node id "${node.id}"`);
    }
    seenIds.add(node.id);
  }
  const nodeIds = new Set(def.nodes.map((n) => n.id));

  for (const [from, to] of def.edges) {
    for (const end of [from, to]) {
      if (end === "__start__" || end === "__end__") continue;
      if (!nodeIds.has(end)) {
        throw new Error(
          `DEFINITION_INVALID: edge endpoint "${end}" not in nodes`,
        );
      }
    }
  }

  if (!def.edges.some(([from]) => from === "__start__")) {
    throw new Error("DEFINITION_INVALID: no edge from __start__");
  }
  if (!def.edges.some(([, to]) => to === "__end__")) {
    throw new Error("DEFINITION_INVALID: nothing reaches __end__");
  }

  const onEdge = new Set<string>();
  for (const [from, to] of def.edges) {
    if (from !== "__start__" && from !== "__end__") onEdge.add(from);
    if (to !== "__start__" && to !== "__end__") onEdge.add(to);
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
  const reachable = new Set<string>(["__start__"]);
  const queue = ["__start__"];
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
