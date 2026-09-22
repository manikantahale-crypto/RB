import { z } from "zod";
import { sha256Hex } from "./sha256.js";

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
  /**
   * The event this workflow is FOR.
   *
   * Not a binding — a binding is the live fact that this event currently
   * starts this workflow, and it is created at go-live. This is the author's
   * intent, recorded when the workflow is accepted so that go-live knows what
   * to bind it to. Without it the trigger was collected at accept time and
   * then dropped, and a workflow could be promoted with nothing routing to it.
   */
  triggerEventType: z.string().min(1).optional(),
  nodes: z
    .array(
      z.object({
        /** Step id on the canvas / in edges (e.g. "match", "resume"). */
        id: z.string().min(1),
        /** Tool / handler key — must exist in runtime nodeRegistry. */
        impl: z.string().min(1),
        /** Canvas visual type — assigned at compile time, not by the LLM. */
        visualType: z.enum(["ai_action", "human_gate"]).optional(),
        /**
         * Where each of this step's inputs comes from: field name → source.
         *
         *     { "jobId": "trigger.requirement_id",
         *       "resumeId": "process.resumeId" }
         *
         * Two roots, two segments, nothing else. `trigger.<field>` is the event
         * that started the run; `<stepId>.<field>` is an earlier step's declared
         * output, read out of the run context.
         *
         * OPTIONAL IN STORAGE, REQUIRED AT GO-LIVE. Definitions are immutable
         * and checksummed, so every version already stored has to stay valid —
         * the schema describes what CAN be stored, including history. What may
         * go live today is the gate's business, and it is allowed to be
         * stricter. A step with no map reads the trigger payload, as every step
         * did before this existed.
         */
        inputs: z.record(z.string(), z.string()).optional(),
        /**
         * The steps this one waits for — a JOIN.
         *
         * A workflow may fan out: several plain edges leave one step and every
         * one of them is taken, the branches running side by side. Where they
         * come back together, the step that needs all of them names them here,
         * and the runtime runs it once, after the last of them, never on
         * partial results. A branch that failed blocks the join.
         *
         * Two or more plain edges INTO a step make it a join whether or not
         * this is written; writing it is what the editor draws and the gate
         * checks. A step with one predecessor never needs it.
         */
        joinOn: z.array(z.string().min(1)).min(1).optional(),
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
  // sha256Hex rather than node:crypto: this package is imported by the admin
  // UI for ROUTER_DEFINITIONS, and a top-level `node:crypto` import made the
  // whole page render white in the browser. See sha256.ts.
  return sha256Hex(JSON.stringify(definition));
}

/* ─────────────────────── where an input comes from ────────────────────── */

/**
 * The one reserved step id. `trigger.<field>` reads the event that started the
 * run, so a step called `trigger` would make every such path ambiguous.
 */
export const TRIGGER_ROOT = "trigger";

export type InputSource =
  | { kind: "trigger"; field: string; path: readonly string[] }
  | { kind: "step"; stepId: string; field: string; path: readonly string[] };

/**
 * Read a source path, or say why it is not one.
 *
 * Two segments is the ordinary case and the only one inference ever writes:
 * `trigger.jobId`, `send.consent_threads`. Anything after the field is a path
 * INTO that value — `send.consent_threads.0.thread_id`.
 *
 * WHY THIS WAS ONCE FORBIDDEN, AND WHAT CHANGED. The limit used to be exactly
 * two, and the reason given was that reaching inside a step's output means the
 * output is carrying a payload, which the run context must not hold: `steps`
 * is checkpointed, and a resume blob in there sits outside the redaction rules
 * each node declares.
 *
 * The discipline is right. The limit was the wrong place to enforce it. What
 * may be stored is a rule about what a node DECLARES as output, and it is
 * enforced there; how deep a later step may READ is a different question, and
 * making the reader clumsy never stopped anybody storing a payload. The case
 * that forced this is `relay.consent.send`, whose `consent_threads` is a list
 * of `{candidate_id, thread_id}` — ids, small, exactly what the run context is
 * for, and unreachable field-by-field before now.
 *
 * `field` stays the first segment either way, so everything that asks "which
 * field of which step" keeps working and only the resolver walks the rest.
 */
export function parseInputSource(
  path: string,
): { ok: true; source: InputSource } | { ok: false; why: string } {
  const parts = path.split(".");
  if (parts.length < 2 || parts.some((p) => p.length === 0)) {
    return {
      ok: false,
      why: `"${path}" is not a source — expected "${TRIGGER_ROOT}.<field>" or "<step>.<field>", with an optional path into it`,
    };
  }
  const [root, field, ...rest] = parts as [string, string, ...string[]];
  return root === TRIGGER_ROOT
    ? { ok: true, source: { kind: "trigger", field, path: rest } }
    : { ok: true, source: { kind: "step", stepId: root, field, path: rest } };
}

/** Structural checks only — does not validate impl against nodeRegistry. */
export function validateGraphTopology(def: GraphDefinition): void {
  const seenIds = new Set<string>();
  for (const node of def.nodes) {
    if (seenIds.has(node.id)) {
      throw new Error(`DEFINITION_INVALID: duplicate node id "${node.id}"`);
    }
    // `trigger` is the one reserved step id: an input source reads
    // `trigger.<field>`, so a step of that name would make every such path
    // mean two things.
    if (node.id === TRIGGER_ROOT) {
      throw new Error(
        `DEFINITION_INVALID: "${TRIGGER_ROOT}" is reserved — it names the event ` +
          `that started the run, so a step cannot be called that`,
      );
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
  // A workflow may reach its end only through a branch arm — every gate's
  // "rejected" and every switch's default path go straight to __end__ — so
  // the arms count. Plain edges alone rejected relay.consent's shape.
  const plainReachesEnd = def.edges.some(([, to]) => to === "__end__");
  const armReachesEnd = (def.conditionalEdges ?? []).some((ce) =>
    Object.values(ce.map).includes("__end__"),
  );
  if (!plainReachesEnd && !armReachesEnd) {
    throw new Error("DEFINITION_INVALID: nothing reaches __end__");
  }

  // A join names the steps it waits for. Each must exist, must not be the
  // join itself, and must actually lead into it by a plain edge — a join
  // waiting on a step that never arrives waits for ever.
  for (const node of def.nodes) {
    if (!node.joinOn) continue;
    const into = new Set(def.edges.filter(([, to]) => to === node.id).map(([from]) => from));
    for (const dep of node.joinOn) {
      if (dep === node.id) {
        throw new Error(`DEFINITION_INVALID: join "${node.id}" waits on itself`);
      }
      if (!nodeIds.has(dep)) {
        throw new Error(`DEFINITION_INVALID: join "${node.id}" waits on "${dep}", which is not a step`);
      }
      if (!into.has(dep)) {
        throw new Error(
          `DEFINITION_INVALID: join "${node.id}" waits on "${dep}", but no edge leads from "${dep}" to it`,
        );
      }
    }
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

  validateInputSources(def, adj, nodeIds);
}

/**
 * Every input source must name something that exists and could have run first.
 *
 * STRUCTURAL ONLY. Whether a source is on EVERY path to this step — which is
 * what a required input needs — depends on which of the step's inputs are
 * required, and that lives in the node registry, not here. This file has never
 * known what a node declares and should not start now; that check belongs with
 * the ones that read the registry.
 *
 * What is caught here is the class of mistake that needs no registry at all: a
 * misspelt path, a step that does not exist, a step that runs later, or one on
 * a branch this step can never be reached from.
 */
function validateInputSources(
  def: GraphDefinition,
  adj: Map<string, string[]>,
  nodeIds: Set<string>,
): void {
  /** Everything reachable from `from`, following edges forward. */
  const reaches = (from: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      for (const next of adj.get(queue.shift()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  };

  const downstream = new Map<string, Set<string>>();

  for (const node of def.nodes) {
    for (const [field, path] of Object.entries(node.inputs ?? {})) {
      const parsed = parseInputSource(path);
      if (!parsed.ok) {
        throw new Error(
          `DEFINITION_INVALID: ${node.id}.inputs.${field} — ${parsed.why}`,
        );
      }
      if (parsed.source.kind === "trigger") continue;

      const { stepId } = parsed.source;
      if (stepId === node.id) {
        throw new Error(
          `DEFINITION_INVALID: ${node.id}.inputs.${field} reads from itself`,
        );
      }
      if (!nodeIds.has(stepId)) {
        throw new Error(
          `DEFINITION_INVALID: ${node.id}.inputs.${field} reads from "${stepId}", ` +
            `which is not a step in this workflow`,
        );
      }
      if (!downstream.has(stepId)) downstream.set(stepId, reaches(stepId));
      if (!downstream.get(stepId)!.has(node.id)) {
        throw new Error(
          `DEFINITION_INVALID: ${node.id}.inputs.${field} reads from "${stepId}", ` +
            `which never runs before it \u2014 there is no path from "${stepId}" to "${node.id}"`,
        );
      }
    }
  }
}
