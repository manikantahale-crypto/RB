import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Canonical graph topology stored in agent_versions.artifact_source and
 * graph_definitions.definition. Shared by authoring, admin-api, and orchestrator.
 */
export const GraphDefinitionSchema = z.object({
  graphKey: z.string().min(1),
  /** Runtime spine agent_definitions.name for seed graphs (optional for admin-authored). */
  agentName: z.string().min(1).optional(),
  stateSchema: z.string().min(1).optional(),
  entryInput: z.string().min(1).optional(),
  nodes: z
    .array(
      z.object({
        /** Step id on the canvas / in edges (e.g. "match", "resume"). */
        id: z.string().min(1),
        /** Tool / handler key — must exist in runtime nodeRegistry. */
        impl: z.string().min(1),
        /** Canvas visual type — assigned at compile time, not by the LLM. */
        visualType: z.enum(["ai_action", "human_gate"]).optional(),
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

export function checksumOf(definition: unknown): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

/** Structural checks only — does not validate impl against nodeRegistry. */
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
  // Nodes referenced only through conditionalEdges are not orphans.
  for (const ce of def.conditionalEdges ?? []) {
    if (ce.from !== "__start__" && ce.from !== "__end__") onEdge.add(ce.from);
    for (const target of Object.values(ce.map)) {
      if (target !== "__start__" && target !== "__end__") onEdge.add(target);
    }
  }
  for (const id of nodeIds) {
    if (!onEdge.has(id)) {
      throw new Error(`DEFINITION_INVALID: orphan node "${id}"`);
    }
  }

  // Validate conditionalEdges structural refs (router key validation is in the
  // authoring layer which knows the allowed router list).
  if (def.conditionalEdges?.length) {
    for (const ce of def.conditionalEdges) {
      if (ce.from !== "__start__" && ce.from !== "__end__" && !nodeIds.has(ce.from)) {
        throw new Error(
          `DEFINITION_INVALID: conditionalEdges "from" node "${ce.from}" not in nodes`,
        );
      }
      for (const [label, target] of Object.entries(ce.map)) {
        if (target !== "__end__" && target !== "__start__" && !nodeIds.has(target)) {
          throw new Error(
            `DEFINITION_INVALID: conditionalEdges map["${label}"] target "${target}" not in nodes`,
          );
        }
      }
    }
  }

  const adj = new Map<string, string[]>();
  for (const [from, to] of def.edges) {
    const list = adj.get(from) ?? [];
    list.push(to);
    adj.set(from, list);
  }
  // Include conditional edge targets in adjacency for reachability check.
  for (const ce of def.conditionalEdges ?? []) {
    const list = adj.get(ce.from) ?? [];
    for (const target of Object.values(ce.map)) {
      list.push(target);
    }
    adj.set(ce.from, list);
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
