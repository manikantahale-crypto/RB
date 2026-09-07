/**
 * Finding the workflows either side of one you are editing.
 *
 * A cross-application flow is stored as a chain — a workflow per application,
 * joined by published events. The editor edits one link, and without this it
 * would show no sign the others exist: somebody who described one flow would
 * open it and find half their work apparently missing.
 *
 * DERIVED, NOT STORED. Nothing records that two workflows are one authored
 * flow, and a column for it is a schema decision nobody has taken. It does not
 * need one: a workflow's routing step carries the handoff event in its config
 * (`astra.route.decision` has `onActionable: "syntra.jd.normalized"`), and that
 * event is bound to the workflow downstream. The chain is recoverable from what
 * is already there.
 *
 * THE HONEST LIMIT. This finds a link only where the handoff event appears in a
 * node's CONFIG. A node that emits from inside its own code says so nowhere a
 * query can reach — `syntra.jd.process` emits `syntra.jd.parsed` from its `run`
 * body — so those links stay invisible until the node contract can declare what
 * a node emits.
 */

export type GraphSummary = {
  graphKey: string;
  definition: {
    /**
     * The event that starts this workflow, for a draft.
     *
     * A draft has no binding — the table permits only `active` and `retired`
     * — so its trigger travels inside the definition. Reading it here is what
     * lets a chain be seen the moment it is accepted, rather than only after
     * every link has gone live.
     */
    entryInput?: string;
    nodes?: Array<{ config?: Record<string, unknown> }>;
  } | null;
};

export type ChainLink = {
  graphKey: string;
  /** The event carrying work across. */
  via: string;
};

export type DerivedChain = {
  graphKey: string;
  /** Workflows publishing an event that starts this one. */
  upstream: ChainLink[];
  /** Workflows started by an event this one publishes. */
  downstream: ChainLink[];
};

/**
 * Events named in a graph's node configs that something is actually bound to.
 *
 * Requiring a binding is what keeps this from reporting every string with a dot
 * in it. `onRejectEvent: "astra.requirement.rejected"` is a real event, but if
 * nothing consumes it there is no downstream workflow to point at.
 */
function eventsNamedIn(
  graph: GraphSummary,
  bound: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const node of graph.definition?.nodes ?? []) {
    for (const value of Object.values(node.config ?? {})) {
      if (typeof value === "string" && bound.has(value)) out.add(value);
    }
  }
  return [...out];
}

export function deriveChain(args: {
  graphKey: string;
  /** Every workflow worth considering — active ones and drafts. */
  graphs: readonly GraphSummary[];
  /** Active bindings: which event starts which workflow. */
  bindings: ReadonlyArray<{ eventType: string; graphKey: string }>;
}): DerivedChain {
  /**
   * What starts each workflow: its binding if it has one, otherwise the
   * trigger inside its own definition.
   *
   * Drafts count. A chain accepted a minute ago has no bindings at all, and a
   * strip that stayed empty until every link went live would be missing at
   * exactly the moment somebody is checking their work.
   */
  const boundTo = new Map<string, string>();
  for (const g of args.graphs) {
    const entry = g.definition?.entryInput;
    if (entry && !boundTo.has(entry)) boundTo.set(entry, g.graphKey);
  }
  // An active binding is the stronger claim and wins over a draft's intent.
  for (const b of args.bindings) boundTo.set(b.eventType, b.graphKey);

  const boundEvents = new Set(boundTo.keys());
  const startsThis = new Set(
    [...boundTo.entries()]
      .filter(([, key]) => key === args.graphKey)
      .map(([event]) => event),
  );

  const upstream: ChainLink[] = [];
  for (const g of args.graphs) {
    if (g.graphKey === args.graphKey) continue;
    for (const event of eventsNamedIn(g, boundEvents)) {
      if (startsThis.has(event)) {
        upstream.push({ graphKey: g.graphKey, via: event });
      }
    }
  }

  const mine = args.graphs.find((g) => g.graphKey === args.graphKey);
  const downstream: ChainLink[] = [];
  if (mine) {
    for (const event of eventsNamedIn(mine, boundEvents)) {
      const to = boundTo.get(event);
      // A workflow that re-enters itself is a loop, not a chain link, and
      // drawing it as a neighbour would be a lie about what happens.
      if (to && to !== args.graphKey) downstream.push({ graphKey: to, via: event });
    }
  }

  return { graphKey: args.graphKey, upstream, downstream };
}
