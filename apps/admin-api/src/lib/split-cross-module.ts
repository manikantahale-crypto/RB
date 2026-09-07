/**
 * Splitting one authored flow into the workflows that will actually run.
 *
 * WHAT AN AUTHOR SEES AND WHAT THE PLATFORM STORES ARE DIFFERENT THINGS.
 *
 * An author should be able to describe work that crosses applications —
 * "when a requirement arrives and finishes intake, match it against our
 * candidates" is one sentence and one intention, and making somebody author it
 * twice in two places is the tool failing them.
 *
 * But it cannot be STORED as one graph. Four reasons, each of them concrete:
 *
 *   - one version pin covering two teams' release cycles, inside a definition
 *     neither of them can see
 *   - a failure in the second application's step re-runs the first's writes,
 *     or strands work already done correctly
 *   - under per-application database roles, a borrowed step running as its
 *     owner's role is privilege escalation invisible in a definition
 *   - the live system already does this as a chain, and it works:
 *     astra.requirement.workflow → syntra.jd.normalized → syntra.authored
 *
 * So the flow is split here, on the way to storage. The author keeps one
 * canvas; the platform gets workflows it can actually route.
 */

import {
  resolveEmits,
  type EmitDeclaration,
} from "@tekisho/node-contract";

export type SplitStep = {
  id: string;
  impl: string;
  config?: Record<string, unknown>;
};

export type Segment = {
  /** The application that owns this stretch of the flow. */
  module: string;
  /** Its steps, in order. */
  stepIds: string[];
  /** Edges within the segment, re-chained and terminated. */
  edges: Array<[string, string]>;
};

export type SplitResult = {
  segments: Segment[];
  /** True when the flow stayed inside one application — the ordinary case. */
  singleModule: boolean;
};

/**
 * Which application a step belongs to, for the purpose of splitting.
 *
 * A shareable step belongs to NOBODY here, and that is deliberate. `human.gate`
 * sitting between two ASTRA steps must not cut the flow into three — borrowing
 * a capability is not a handoff, and the whole point of `shareable` is that it
 * crosses boundaries without being one.
 */
function ownerOf(
  impl: string,
  moduleOf: Map<string, string>,
  shareable: Set<string>,
): string | null {
  if (shareable.has(impl)) return null;
  return moduleOf.get(impl) ?? null;
}

/** Steps in the order the graph runs them. */
export function orderedSteps(
  nodes: readonly SplitStep[],
  edges: readonly (readonly [string, string])[],
): string[] {
  const known = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (known.has(id)) out.push(id);
    for (const [from, to] of edges) if (from === id) walk(to);
  };
  walk("__start__");
  // An orphan is still somebody's step; losing it in a split would be worse
  // than reporting it out of place.
  for (const n of nodes) if (!seen.has(n.id)) out.push(n.id);
  return out;
}

/**
 * Cut the flow wherever the owning application changes.
 *
 * Neutral steps join whichever segment they sit in — the one before them —
 * because a gate belongs to the work it is gating, not to a segment of its
 * own. A neutral step before any owned step joins the first segment.
 */
export function splitByModule(args: {
  nodes: readonly SplitStep[];
  edges: readonly (readonly [string, string])[];
  moduleOf: Map<string, string>;
  shareable: Set<string>;
}): SplitResult {
  const order = orderedSteps(args.nodes, args.edges);
  const byId = new Map(args.nodes.map((n) => [n.id, n]));

  const segments: Segment[] = [];
  let current: Segment | null = null;
  /** Neutral steps seen before any owned one — they belong to whoever is first. */
  let pending: string[] = [];

  for (const id of order) {
    const impl = byId.get(id)?.impl;
    if (!impl) continue;
    const owner = ownerOf(impl, args.moduleOf, args.shareable);

    if (owner === null) {
      if (current) current.stepIds.push(id);
      else pending.push(id);
      continue;
    }

    if (!current || current.module !== owner) {
      current = { module: owner, stepIds: [...pending, id], edges: [] };
      pending = [];
      segments.push(current);
    } else {
      current.stepIds.push(id);
    }
  }

  // A flow made only of shareable steps has no owner at all. Rather than
  // inventing one, it stays a single unattributed segment.
  if (segments.length === 0 && pending.length > 0) {
    segments.push({ module: "platform", stepIds: pending, edges: [] });
  } else if (pending.length > 0 && segments[0]) {
    segments[0].stepIds.unshift(...pending);
  }

  for (const seg of segments) {
    seg.edges = chain(seg.stepIds);
  }

  return { segments, singleModule: segments.length <= 1 };
}

/** `__start__ → a → b → __end__`, the shape every stored workflow needs. */
function chain(stepIds: readonly string[]): Array<[string, string]> {
  if (stepIds.length === 0) return [];
  const edges: Array<[string, string]> = [["__start__", stepIds[0]!]];
  for (let i = 0; i < stepIds.length - 1; i += 1) {
    edges.push([stepIds[i]!, stepIds[i + 1]!]);
  }
  edges.push([stepIds[stepIds.length - 1]!, "__end__"]);
  return edges;
}

/* ─────────────────────────── joining them up ──────────────────────────── */

export type Handoff = {
  fromModule: string;
  toModule: string;
  /** The event that carries the work across. */
  eventType: string;
  /** Whether it already exists in the catalogue, or has to be registered. */
  exists: boolean;
  /** An active workflow already started by this event, if any. */
  handledBy: string | null;
};

export type ModuleFacts = {
  key: string;
  /** Events this application publishes across a boundary. */
  handsOff: readonly string[];
  /** Events that start work in it. */
  frontDoor: readonly string[];
};

/**
 * The event joining two segments, preferring one that already exists.
 *
 * Order of preference, and the reasons matter:
 *
 *   1. An event the upstream application already publishes AND the downstream
 *      one already takes in. That is a road both sides have already agreed on.
 *   2. Anything the upstream publishes. The downstream side is new work, but
 *      nobody has to change what they emit.
 *   3. Anything the downstream takes in — the upstream must start emitting it.
 *   4. A proposed name. Adding to a shared catalogue is the last resort, not
 *      the first, because every application lives with the result.
 */
export function resolveHandoff(
  from: ModuleFacts,
  to: ModuleFacts,
  known: Set<string>,
  boundTo: Map<string, string>,
): Handoff {
  const both = from.handsOff.find((e) => to.frontDoor.includes(e));
  const upstream = from.handsOff.find((e) => known.has(e));
  const downstream = to.frontDoor.find((e) => known.has(e));

  const chosen = both ?? upstream ?? downstream ?? null;
  if (chosen) {
    return {
      fromModule: from.key,
      toModule: to.key,
      eventType: chosen,
      exists: true,
      handledBy: boundTo.get(chosen) ?? null,
    };
  }

  /**
   * Nothing fits, so propose one. Named for the boundary rather than for the
   * work, because the name will outlive whatever prompted it and a reader
   * needs to see which two applications it joins.
   */
  return {
    fromModule: from.key,
    toModule: to.key,
    eventType: `${to.key}.${from.key}.handoff`,
    exists: false,
    handledBy: null,
  };
}

/* ──────────────────── whether to split at all ─────────────────────────── */

export type ChainDecision = {
  /** True to store one workflow per application, joined by events. */
  chain: boolean;
  /** Plain English, shown to the author. */
  reason: string;
};

/**
 * Splitting is a choice, not a law — so make it deliberately.
 *
 * The module boundary in this system is LOGICAL. One worker process serves
 * every module queue and one registry holds every module's nodes, so a single
 * graph containing two applications' steps compiles and runs today, driven by
 * its edges, in one job. Nothing has to be emitted for it to finish.
 *
 * That matters because a chain is not free. The two halves are separate runs
 * with separate state — only the handoff event's payload crosses — so the join
 * has to be published by somebody. When it is not, the second half never
 * starts, and nothing anywhere reports a failure: the first workflow succeeds
 * and the work simply stops.
 *
 * So the split has to earn that risk, and there is exactly one case where it
 * does: the downstream work ALREADY EXISTS. Handing off to a live workflow
 * reuses something a team built and maintains, instead of growing a second
 * copy of it that drifts. That is worth an event boundary.
 *
 * Authoring genuinely new work across two applications is not. One graph runs
 * it correctly, start to finish, with no join to go missing.
 */
export function decideChain(
  handoffs: ReadonlyArray<Handoff | null>,
): ChainDecision {
  const reuse = handoffs.filter((h) => h?.handledBy);
  if (reuse.length > 0) {
    const names = [...new Set(reuse.map((h) => h!.handledBy!))];
    return {
      chain: true,
      reason: `${names.join(" and ")} already does part of this, so this hands off to it rather than repeating it.`,
    };
  }
  return {
    chain: false,
    reason:
      "Nothing downstream exists to reuse, so this stays one workflow that runs " +
      "the whole way through rather than two halves joined by an event.",
  };
}

/**
 * Can this stretch of the flow actually publish the event that carries work on?
 *
 * Three answers, and the third one is the honest part.
 *
 *   "yes"      a step declares this event, or carries it in its settings
 *   "no"       EVERY step here has declared what it publishes, and none of
 *              them publish this. A real negative, safe to block on.
 *   "unknown"  at least one step has not declared. It might publish this from
 *              inside its own code; nothing here can tell.
 *
 * Before nodes declared `emits`, only "yes" and "unknown" were available and
 * "unknown" covered almost everything — the check could see a handoff carried
 * in config and nothing else. Every ASTRA and ORBIT node is still undeclared,
 * so "unknown" remains the common answer there; it shrinks as they convert.
 *
 * The config fallback stays for exactly those undeclared nodes:
 * `astra.route.decision` publishes whatever `onActionable` names, and that is
 * visible in the definition even though the node has declared nothing.
 */
export function emitsEvent(args: {
  nodes: readonly SplitStep[];
  eventType: string;
  /**
   * Node key → what it declared. `null` for a node that has not declared,
   * which is NOT the same as a node that declared an empty list.
   */
  emitsOf: ReadonlyMap<string, EmitDeclaration[] | null>;
}): "yes" | "no" | "unknown" {
  let allDeclared = true;

  for (const n of args.nodes) {
    const declared = args.emitsOf.get(n.impl) ?? null;

    if (declared) {
      if (resolveEmits(declared, n.config).includes(args.eventType)) return "yes";
      continue;
    }

    allDeclared = false;
    // Undeclared, so fall back to what the definition shows: a handoff the
    // author wired as a setting is still a handoff.
    for (const v of Object.values(n.config ?? {})) {
      if (typeof v === "string" && v === args.eventType) return "yes";
    }
  }

  return allDeclared ? "no" : "unknown";
}

/* ─────────────── what else a flow sets running, unasked ───────────────── */

export type TriggeredWorkflow = {
  /** The step in this flow that publishes. */
  stepId: string;
  impl: string;
  eventType: string;
  /** The workflow that event starts. */
  graphKey: string;
  /**
   * Steps this flow runs that the triggered workflow ALSO runs.
   *
   * Non-empty is the bad case: the same work happens twice for one input,
   * once here and once in the workflow this flow set going.
   */
  alsoRunsHere: string[];
};

/**
 * Workflows this flow starts by publishing, whether the author meant to or not.
 *
 * THE THING NOBODY CAN SEE.
 *
 * A step that emits is not just recording something. Six of the nine SYNTRA
 * nodes publish an event from inside `run`, several of those events are bound
 * to a workflow, and a bound event starts that workflow as a separate run. So
 * putting a step on a canvas can set a whole other workflow going, and until
 * `emits` was declared there was no way to know from the definition.
 *
 * The live example, and the reason this exists: `syntra.jd.process` publishes
 * `syntra.jd.parsed`, which is bound to `syntra.continuous.match`. A flow with
 * BOTH `jd.process` and `continuous.match` in it therefore matches twice for
 * one job — once as its own next step, once in the workflow the first step
 * started. Two sets of results for one requirement, no error, nothing in a log
 * saying anything happened at all.
 *
 * Reported rather than blocked. Triggering another workflow is often exactly
 * the intention — that is what a handoff IS — and only the author knows which
 * of the two they meant.
 */
export function detectTriggeredWorkflows(args: {
  nodes: readonly SplitStep[];
  /** Node key → what it declared. `null` for a node that has not declared. */
  emitsOf: ReadonlyMap<string, EmitDeclaration[] | null>;
  /** Active event → the graph it starts. */
  boundTo: ReadonlyMap<string, string>;
  /** Graph key → the node keys that workflow runs. */
  implsOf: ReadonlyMap<string, readonly string[]>;
  /** This flow's own key, so re-entering itself is not reported as a stranger. */
  selfGraphKey?: string;
}): TriggeredWorkflow[] {
  const here = new Set(args.nodes.map((n) => n.impl));
  const out: TriggeredWorkflow[] = [];

  for (const node of args.nodes) {
    const declared = args.emitsOf.get(node.impl);
    // Undeclared is not silent — it is unknown, and guessing "publishes
    // nothing" is exactly the error this whole field was added to stop.
    if (!declared) continue;

    for (const eventType of resolveEmits(declared, node.config)) {
      const graphKey = args.boundTo.get(eventType);
      if (!graphKey || graphKey === args.selfGraphKey) continue;

      out.push({
        stepId: node.id,
        impl: node.impl,
        eventType,
        graphKey,
        alsoRunsHere: (args.implsOf.get(graphKey) ?? []).filter((impl) =>
          here.has(impl),
        ),
      });
    }
  }

  return out;
}
