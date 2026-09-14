/**
 * Wire the last step to `__end__` when the model forgot to.
 *
 * WHY THIS IS A REPAIR AND NOT A GUESS.
 *
 * `validateGraphTopology` requires at least one edge into `__end__`, and a
 * proposal without one is thrown away whole — the author then sees a single
 * arbitrary placeholder step instead of the workflow the model actually built.
 *
 * Measured on gpt-4o-mini against the real registry, two of three requests
 * failed for exactly this and nothing else: the steps were right, the order was
 * right, every impl was in the registry, and no edge said where the flow
 * finished. Discarding that is a bad trade — the model did the part that needs
 * judgement and missed the part that needs none.
 *
 * So this adds the missing edge and nothing else. It does not invent a step,
 * reorder anything, choose between candidates, or change a single node. If the
 * proposal is unsalvageable for any other reason it stays unsalvageable, and
 * the caller still refuses it.
 *
 * WHAT COUNTS AS THE END. Every node with no outgoing edge is a sink, and each
 * one gets an edge to `__end__`. A branching flow has several sinks and all of
 * them finish — terminating only the first would silently strand the other
 * arms, which is worse than the error this replaces.
 *
 * Untouched when the model got it right, when there are no nodes, or when
 * nothing connects at all. An unreachable node is a different fault and is left
 * to the validator to report.
 */

type Edge = [string, string];

export type OpenEndedGraph = {
  nodes?: unknown;
  edges?: unknown;
  conditionalEdges?: unknown;
  [key: string]: unknown;
};

/** Ids the flow leaves through, in the order the nodes were declared. */
export function sinksOf(
  nodeIds: readonly string[],
  edges: readonly Edge[],
  conditionalTargets: readonly string[] = [],
): string[] {
  const hasOutgoing = new Set<string>();
  for (const [from] of edges) hasOutgoing.add(from);
  /**
   * A branch's source leaves through its arms, not through an ordinary edge.
   * Without this the decision node reads as a sink and gets wired straight to
   * `__end__`, which shortcuts every arm it was supposed to choose between.
   */
  for (const from of conditionalTargets) hasOutgoing.add(from);
  return nodeIds.filter((id) => !hasOutgoing.has(id));
}

export function closeOpenEnds<T extends OpenEndedGraph>(graph: T): T {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  if (nodes.length === 0) return graph;

  const edges: Edge[] = Array.isArray(graph.edges)
    ? (graph.edges as unknown[]).filter(
        (e): e is Edge =>
          Array.isArray(e) &&
          e.length === 2 &&
          typeof e[0] === "string" &&
          typeof e[1] === "string",
      )
    : [];

  // Already finished. The common case, and it must cost nothing.
  if (edges.some(([, to]) => to === "__end__")) return graph;

  const nodeIds = nodes
    .map((n) =>
      n && typeof n === "object" && !Array.isArray(n)
        ? String((n as { id?: unknown }).id ?? "")
        : "",
    )
    .filter(Boolean);
  if (nodeIds.length === 0) return graph;

  const branchSources = Array.isArray(graph.conditionalEdges)
    ? (graph.conditionalEdges as unknown[])
        .map((c) =>
          c && typeof c === "object" && !Array.isArray(c)
            ? String((c as { from?: unknown }).from ?? "")
            : "",
        )
        .filter(Boolean)
    : [];

  const open = sinksOf(nodeIds, edges, branchSources);

  /**
   * Nothing open and nothing reaching the end means the flow loops back on
   * itself. That is a real fault, not a missing edge, and inventing a terminal
   * would hide it — so it goes back untouched for the validator to reject.
   */
  if (open.length === 0) return graph;

  return { ...graph, edges: [...edges, ...open.map((id): Edge => [id, "__end__"])] };
}
