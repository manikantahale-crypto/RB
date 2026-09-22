/**
 * WORK OUT WHERE EACH STEP'S DATA COMES FROM, SO NOBODY HAS TO SAY.
 *
 * A step is handed the trigger payload. Anything else it needs — a field an
 * EARLIER STEP produced — reaches it only through an input map:
 *
 *     inputs: { consent_threads: "send.consent_threads" }
 *
 * That map is the difference between a workflow that runs and one that fails
 * on its first real event, and until now the only way to get one was to type
 * it. Which means the person authoring a workflow had to know that
 * `relay.consent.remind` takes a field called `consent_threads`, that
 * `relay.consent.send` produces one, and that the step is called `send`. That
 * is the node's internals, and asking for it defeats the point of a tool whose
 * promise is "describe what you want".
 *
 * Nobody needs to say it, because both sides already declared themselves. Every
 * contract states its `input` and its `output`, and `node_registry` carries
 * both. So the map can be WORKED OUT: for each field a step needs that the
 * trigger does not carry, find the upstream step whose declared output has that
 * name, and write it down.
 *
 * IT IS WRITTEN DOWN, NOT RESOLVED AT RUN TIME. The definition still says where
 * every field comes from, so it can be read, diffed, checked by the go-live
 * gate, and explained on screen. The author simply never types it.
 *
 * WHAT IT WILL NOT DO:
 *   - overwrite a map that is already there. Somebody said that on purpose.
 *   - invent a source. A field nothing upstream produces stays unmapped, and
 *     `checkInputsAvailable` reports it in the author's words at go-live.
 *   - guess between two equally good sources. A step that runs on EVERY route
 *     to this one beats a step that runs on some of them, and among equals the
 *     NEAREST wins. Both rules are deterministic, and the first is the one
 *     `checkInputsAvailable` judges the result by — pick a source off a branch
 *     arm for a required field and the gate refuses the map it was just handed.
 */
import { alwaysRunsBefore } from "./check-inputs-available.js";
import type { GraphDefinition } from "./graph-definition.js";

export type InferInputsArgs = {
  def: GraphDefinition;
  /** Field names each impl DECLARES it produces, from `node_registry`. */
  outputsByImpl: Map<string, readonly string[]>;
  /** Field names each impl reads. Required and optional together. */
  inputsByImpl: Map<string, readonly string[]>;
  /** What the trigger event carries — the floor under every step. */
  triggerFields: readonly string[];
};

/** One wiring decision, in the words a screen can show. */
export type WiredInput = {
  nodeId: string;
  field: string;
  fromStep: string;
  /** `"<fromStep>.<field>"` — what goes in the definition. */
  source: string;
};

export type InferInputsResult = {
  def: GraphDefinition;
  wired: WiredInput[];
};

/**
 * Every step that can reach `nodeId`, best source first.
 *
 * Nearest means fewest steps back, so a field produced twice comes from the
 * one a reader would point at. Branch arms count as edges: a step reached only
 * through an arm still has everything before the branch upstream of it.
 *
 * But a step on a branch arm only SOMETIMES runs, and a field taken from one
 * is absent on every other route. So the steps that always run come first, in
 * nearest order, and the conditional ones after them — still offered, because
 * a workflow whose only source is conditional should be wired and then told
 * about it in the gate's words, not left silently unwired.
 */
function upstreamNearestFirst(def: GraphDefinition, nodeId: string): string[] {
  const parents = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    if (from === "__start__" || to === "__end__") return;
    const list = parents.get(to) ?? [];
    if (!list.includes(from)) list.push(from);
    parents.set(to, list);
  };
  for (const [from, to] of def.edges) add(from, to);
  for (const ce of def.conditionalEdges ?? []) {
    for (const target of Object.values(ce.map)) add(ce.from, target);
  }

  const order: string[] = [];
  const seen = new Set<string>([nodeId]);
  let frontier = parents.get(nodeId) ?? [];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const p of parents.get(id) ?? []) if (!seen.has(p)) next.push(p);
    }
    frontier = next;
  }
  const always = alwaysRunsBefore(def, nodeId);
  return [...order.filter((id) => always.has(id)), ...order.filter((id) => !always.has(id))];
}

export function inferInputMaps(args: InferInputsArgs): InferInputsResult {
  const { def, outputsByImpl, inputsByImpl } = args;
  const triggerFields = new Set(args.triggerFields);
  const implOf = new Map(def.nodes.map((n) => [n.id, n.impl]));
  const wired: WiredInput[] = [];

  const nodes = def.nodes.map((node) => {
    const needs = inputsByImpl.get(node.impl) ?? [];
    if (needs.length === 0) return node;

    const existing = node.inputs ?? {};
    const additions: Record<string, string> = {};
    const upstream = upstreamNearestFirst(def, node.id);

    for (const field of needs) {
      // Somebody already said where this comes from.
      if (existing[field]) continue;
      // The trigger carries it, and the trigger is the floor under every step.
      if (triggerFields.has(field)) continue;

      const from = upstream.find((id) => {
        const impl = implOf.get(id);
        return impl ? (outputsByImpl.get(impl) ?? []).includes(field) : false;
      });
      if (!from) continue; // nothing produces it; the gate will say so

      additions[field] = `${from}.${field}`;
      wired.push({ nodeId: node.id, field, fromStep: from, source: `${from}.${field}` });
    }

    if (Object.keys(additions).length === 0) return node;
    return { ...node, inputs: { ...existing, ...additions } };
  });

  return { def: { ...def, nodes }, wired };
}

/**
 * The same decisions as a sentence per step, for the editor to show.
 *
 * "reminder takes consent threads from ask for consent" is the whole point:
 * the author sees what was worked out, in their words, and never types it.
 */
export function describeWiring(
  wired: readonly WiredInput[],
  titleOf: (nodeId: string) => string = (id) => id,
): string[] {
  const byNode = new Map<string, WiredInput[]>();
  for (const w of wired) {
    byNode.set(w.nodeId, [...(byNode.get(w.nodeId) ?? []), w]);
  }
  return [...byNode.entries()].map(([nodeId, items]) => {
    const fields = items.map((i) => i.field);
    const sources = [...new Set(items.map((i) => titleOf(i.fromStep)))];
    const list =
      fields.length === 1
        ? fields[0]
        : `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
    return `${titleOf(nodeId)} takes ${list} from ${sources.join(" and ")}`;
  });
}
