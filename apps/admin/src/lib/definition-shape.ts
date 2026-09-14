/**
 * A stored definition is not guaranteed to be a definition.
 *
 * `authoring.graph_versions.definition` is jsonb, and jsonb holds `{}` as
 * cheerfully as it holds a workflow. One row in the reference database does:
 * `orbit.lifecycle.workflow` v9, status `live`, definition `{}` — no nodes, no
 * edges, no graphKey. Its draft is the same.
 *
 * ONE SUCH ROW USED TO TAKE THE WHOLE APP DOWN.
 *
 * The editor reads `draft.nodes` and `draft.edges` directly in a dozen places,
 * and `definition.nodes[0]` on load was the first of them. Against `{}` that
 * threw "Cannot read properties of undefined (reading '0')" during render, the
 * error boundary caught it, and the author got "Something went wrong loading
 * the Builder" — no workflow name, no hint that one row was responsible, and
 * the same blank page for every workflow they opened next.
 *
 * Normalising once, here, rather than guarding at each use site is deliberate:
 * a guard added in twelve places is a guard the thirteenth place forgets, and
 * what it produces when forgotten is exactly this failure again.
 */

import type { GraphDefinition } from "../api/editor";

/** Does this definition carry the two arrays every screen assumes? */
export function isWellFormed(definition: unknown): boolean {
  const d = definition as Partial<GraphDefinition> | null | undefined;
  return Array.isArray(d?.nodes) && Array.isArray(d?.edges);
}

/**
 * The definition, with `nodes` and `edges` guaranteed to be arrays.
 *
 * Everything else on the object is preserved untouched — `graphKey`,
 * `entryInput`, `conditionalEdges` and anything a later version adds. This
 * repairs the shape the editor needs, not the content.
 *
 * It does NOT quietly write the repair back. `isWellFormed` is what the caller
 * uses to say so on screen, so an empty canvas cannot be mistaken for a
 * workflow whose steps someone deleted.
 */
export function usableDefinition(definition: unknown): GraphDefinition {
  const d = (definition ?? {}) as Partial<GraphDefinition>;
  return {
    ...(d as GraphDefinition),
    nodes: Array.isArray(d.nodes) ? d.nodes : [],
    edges: Array.isArray(d.edges) ? d.edges : [],
  };
}
