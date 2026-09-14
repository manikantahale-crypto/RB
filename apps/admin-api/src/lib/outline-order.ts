/**
 * The order a workflow's steps are read in.
 *
 * NOT THE ORDER THEY ARE STORED IN. `definition.nodes` is the order steps were
 * added in the editor, which for anything that has been edited is not the
 * order they run in — a step inserted between two others goes on the end of
 * the array. A summary that lists the steps in storage order is not a summary
 * of the workflow, it is a summary of how somebody built it, and the two stop
 * agreeing the first time anyone inserts a step.
 *
 * So this is Kahn's algorithm over the edges: a step appears once everything
 * that leads to it has appeared.
 *
 * THE AWKWARD CASES ARE THE POINT.
 *
 * A node no edge reaches is real — a step left disconnected mid-edit — and it
 * still appears, at the end. Dropping it would hide the single thing that
 * explains why a workflow does less than its canvas suggests. A cycle is the
 * same: the nodes in it come out after everything else rather than vanishing.
 * Either way the returned list always has exactly one entry per node, which is
 * what lets the caller trust `steps.length` as the step count.
 */

export type OutlineGraph = {
  nodes?: Array<{ id?: string }>;
  edges?: Array<[string, string]>;
  conditionalEdges?: Array<{ from?: string; map?: Record<string, string> }>;
};

export function orderSteps(definition: OutlineGraph): string[] {
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition.edges) ? definition.edges : [];
  const conditional = Array.isArray(definition.conditionalEdges)
    ? definition.conditionalEdges
    : [];

  // Insertion order is the tie-breaker, so two independent branches come back
  // in the order they were authored rather than in whatever order a hash
  // happened to produce.
  const known = new Set<string>();
  for (const n of nodes) {
    const id = String(n?.id ?? "");
    if (id) known.add(id);
  }

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of known) indegree.set(id, 0);

  const addEdge = (from: string, to: string) => {
    // `__start__` and `__end__` are not steps. An edge from one still matters
    // — it is what makes the first real step reachable — but it must not add
    // to that step's indegree or nothing would ever be ready to emit.
    if (!known.has(to)) return;
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from)!.push(to);
    if (known.has(from)) indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  for (const [from, to] of edges) addEdge(String(from), String(to));
  for (const c of conditional) {
    for (const target of Object.values(c?.map ?? {})) {
      addEdge(String(c?.from ?? ""), String(target));
    }
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = [...known].filter((id) => (indegree.get(id) ?? 0) === 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    for (const next of outgoing.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if ((indegree.get(next) ?? 0) <= 0 && !seen.has(next)) queue.push(next);
    }
  }

  // Anything in a cycle, or pointed at by something unreachable.
  for (const id of known) if (!seen.has(id)) ordered.push(id);

  return ordered;
}
