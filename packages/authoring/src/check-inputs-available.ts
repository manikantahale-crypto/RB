/**
 * Can every step actually get what it needs?
 *
 * This is the first check in the system about DATA rather than shape. The six
 * that exist all ask whether the graph is well-formed — impls exist, it is
 * connected, the checksum matches. None asks whether the workflow can run,
 * which is why `syntra.match.workflow` is live today with a step needing
 * `resumeId` that its trigger does not carry. It passes everything and dies on
 * its first real event.
 *
 * WHAT AVAILABILITY MEANS HERE. A step receives the trigger payload with its
 * resolved input map merged on top — see `resolve-inputs.ts`. So a field is
 * available to a step if the trigger declares it, or the step maps it. Not
 * "whatever earlier steps produced": an earlier step's output reaches nobody
 * unless a map names it.
 *
 * THE BRANCH RULE. A required field mapped from an earlier step needs that
 * step to have run — and on a branching graph, "earlier" is not enough. The
 * source must be on EVERY path that reaches this step, or there is a route
 * through the workflow where the field is absent and the node fails its own
 * input schema. Optional fields are exempt: the node declared it can cope.
 */
import {
  parseInputSource,
  type GraphDefinition,
} from "@tekisho/graph-contract";

export type InputProblem = {
  nodeId: string;
  field: string;
  /** Plain sentence naming what is wrong and where. */
  message: string;
};

export type CheckInputsArgs = {
  def: GraphDefinition;
  /** Property names the trigger event's payload schema declares. */
  triggerFields: readonly string[];
  /** Node key → the field names its input schema marks required. */
  requiredByImpl: Map<string, readonly string[]>;
};

/**
 * Every node that runs on every path from `__start__` to `target`.
 *
 * The dominator set, computed the plain way: for each node, try reaching the
 * target with that node removed. If the target is still reachable, the node is
 * skippable and cannot be depended on.
 *
 * Graphs here are a handful of steps, so the simple version is the right one —
 * a proper dominator algorithm would be faster and harder to be sure of.
 */
function alwaysRunsBefore(def: GraphDefinition, target: string): Set<string> {
  const edges: Array<[string, string]> = [
    ...def.edges.map(([a, b]) => [a, b] as [string, string]),
    ...(def.conditionalEdges ?? []).flatMap((ce) =>
      Object.values(ce.map).map((to) => [ce.from, to] as [string, string]),
    ),
  ];

  const reaches = (skip: string | null): boolean => {
    const seen = new Set<string>(["__start__"]);
    const queue = ["__start__"];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === target) return true;
      for (const [from, to] of edges) {
        if (from !== cur || to === skip || seen.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return seen.has(target);
  };

  const always = new Set<string>();
  for (const node of def.nodes) {
    if (node.id === target) continue;
    if (!reaches(node.id)) always.add(node.id);
  }
  return always;
}

/** Empty when every step can get everything it requires. */
export function checkInputsAvailable(args: CheckInputsArgs): InputProblem[] {
  const { def, requiredByImpl } = args;
  const triggerFields = new Set(args.triggerFields);
  const problems: InputProblem[] = [];

  for (const node of def.nodes) {
    const required = requiredByImpl.get(node.impl) ?? [];
    if (required.length === 0) continue;
    const inputs = node.inputs ?? {};

    for (const field of required) {
      const mapped = inputs[field];

      if (!mapped) {
        // No map: the field has to be on the trigger, which is how every
        // workflow written before input maps existed works.
        if (!triggerFields.has(field)) {
          problems.push({
            nodeId: node.id,
            field,
            message:
              `${node.id} needs "${field}" and nothing provides it — ` +
              `the trigger does not carry it and no source is mapped`,
          });
        }
        continue;
      }

      const parsed = parseInputSource(mapped);
      if (!parsed.ok) {
        problems.push({
          nodeId: node.id,
          field,
          message: `${node.id}.inputs.${field} — ${parsed.why}`,
        });
        continue;
      }

      if (parsed.source.kind === "trigger") {
        if (!triggerFields.has(parsed.source.field)) {
          problems.push({
            nodeId: node.id,
            field,
            message:
              `${node.id} needs "${field}" from the trigger's ` +
              `"${parsed.source.field}", which this event does not carry`,
          });
        }
        continue;
      }

      // From an earlier step, and required — so it must be on every path.
      const { stepId } = parsed.source;
      if (!alwaysRunsBefore(def, node.id).has(stepId)) {
        problems.push({
          nodeId: node.id,
          field,
          message:
            `${node.id} needs "${field}" from "${stepId}", but there is a ` +
            `route through this workflow where "${stepId}" never runs`,
        });
      }
    }
  }

  return problems;
}
