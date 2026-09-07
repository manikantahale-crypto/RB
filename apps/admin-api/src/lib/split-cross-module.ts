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
