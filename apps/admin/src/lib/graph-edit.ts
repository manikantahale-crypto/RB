/**
 * Structural edits to a graph definition — insert a step on an edge, remove a
 * step — as pure functions over the definition.
 *
 * They live here rather than inside the editor screen for two reasons. They are
 * the only place that understands a definition has TWO edge lists (`edges` and
 * `conditionalEdges`), and getting that wrong silently corrupts a workflow: a
 * step inserted on a branch arm used to be appended to `edges` while the arm
 * kept pointing at the original target, leaving the branch with a plain edge
 * AND its arms — in LangGraph both fire, and the inserted step is skipped on
 * the very path it was inserted into.
 *
 * The other reason is that an edit is worth testing, and a React component that
 * imports the canvas is not.
 */
import type { GraphDefinition } from "../api/editor";

/**
 * Which edge an insertion is happening on, in DEFINITION space.
 *
 * Deliberately not the canvas edge id. The canvas draws `__start__` as a
 * trigger chip and `__end__` as a "done" marker, and it used to hand those
 * display ids back as a string that had to be split on `->` and then on `:` to
 * recover the arm label. Any id containing either character broke it. Here the
 * caller resolves the ids once, at the point where it already knows both.
 */
export type EdgeRef =
  | { kind: "plain"; from: string; to: string }
  | { kind: "conditional"; from: string; label: string; to: string };

/** A step id derived from the node key, so nobody has to invent one. */
export function nextStepId(def: GraphDefinition, implKey: string): string {
  const base = implKey.split(".").pop() ?? "step";
  let id = base;
  let n = 2;
  while (def.nodes.some((x) => x.id === id)) id = `${base}${n++}`;
  return id;
}

/**
 * Insert a step on an edge: A → B becomes A → new → B.
 *
 * On a plain edge that is a swap of one edge for two. On a branch arm it is
 * NOT: the incoming side is the arm itself, so the arm is repointed at the new
 * step and only the outgoing side becomes a plain edge. The branch keeps
 * exactly its arms and gains no plain edge.
 */
export function insertOnEdge(
  def: GraphDefinition,
  ref: EdgeRef,
  implKey: string,
): { def: GraphDefinition; newNodeId: string } {
  const id = nextStepId(def, implKey);
  const nodes = [...def.nodes, { id, impl: implKey, config: {} }];

  if (ref.kind === "plain") {
    return {
      newNodeId: id,
      def: {
        ...def,
        nodes,
        edges: [
          ...def.edges.filter(([a, b]) => !(a === ref.from && b === ref.to)),
          [ref.from, id] as [string, string],
          [id, ref.to] as [string, string],
        ],
      },
    };
  }

  return {
    newNodeId: id,
    def: {
      ...def,
      nodes,
      edges: [...def.edges, [id, ref.to] as [string, string]],
      conditionalEdges: (def.conditionalEdges ?? []).map((ce) =>
        ce.from === ref.from && ce.map[ref.label] === ref.to
          ? { ...ce, map: { ...ce.map, [ref.label]: id } }
          : ce,
      ),
    },
  };
}

/**
 * Remove a step and heal the chain around it — through both edge lists.
 *
 * Three cases, and only the first used to be handled:
 *   - plain in, plain out      → cross-product, as before
 *   - the step IS the decision → its arms go with it
 *   - an arm points at it      → the arm is repointed at what the step led to,
 *                                or to `__end__`, which is always a legal
 *                                target and never strands the arm
 */
export function removeStep(def: GraphDefinition, id: string): GraphDefinition {
  const incoming = def.edges.filter(([, b]) => b === id).map(([a]) => a);
  const plainOut = def.edges.filter(([a]) => a === id).map(([, b]) => b);

  /**
   * A decision's exits are its arms, not plain edges, so healing only through
   * `edges` would leave whatever led into it pointing at nothing.
   *
   * Only the FIRST arm target is reconnected. Joining all of them would give a
   * plain node several outgoing edges, which in LangGraph means every one of
   * them runs — the same corruption this module exists to prevent. Deleting a
   * decision destroys its branching by definition; the paths that are left
   * behind show up in the validation rail as stranded steps, which is a
   * truthful thing to hand back to whoever deleted it.
   */
  const armTargets = (def.conditionalEdges ?? [])
    .filter((ce) => ce.from === id)
    .flatMap((ce) => Object.values(ce.map));
  const outgoing = plainOut.length > 0 ? plainOut : armTargets.slice(0, 1);

  const healed: Array<[string, string]> = [];
  for (const a of incoming) for (const b of outgoing) healed.push([a, b]);

  const fallback = plainOut[0] ?? "__end__";

  const conditionalEdges = (def.conditionalEdges ?? [])
    // The decision itself is going. Its arms have no source left.
    .filter((ce) => ce.from !== id)
    .map((ce) => {
      const map: Record<string, string> = {};
      for (const [label, target] of Object.entries(ce.map)) {
        map[label] = target === id ? fallback : target;
      }
      return { ...ce, map };
    })
    // A fork with nothing to fork to is not a fork.
    .filter((ce) => Object.keys(ce.map).length > 0);

  const next: GraphDefinition = {
    ...def,
    nodes: def.nodes.filter((x) => x.id !== id),
    edges: [
      ...def.edges.filter(([a, b]) => a !== id && b !== id),
      ...healed,
    ],
    conditionalEdges,
  };
  if (conditionalEdges.length === 0) delete next.conditionalEdges;
  return next;
}
