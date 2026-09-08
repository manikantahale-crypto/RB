/**
 * Answer the request from what already runs, before asking a model to invent
 * something.
 *
 * MOST DESCRIPTIONS ARE A CHANGE TO SOMETHING THAT ALREADY EXISTS.
 *
 * "When a requirement arrives and finishes intake, match it against our
 * candidates. Accept at 92" reads like a new workflow and is not one. That
 * chain runs today. The only thing the sentence actually asks for is one field:
 * `matchThreshold`, 60 → 92, on one step.
 *
 * Generating anyway produces a second workflow that does what the first one
 * already does, with a different threshold, bound to nothing — and the author
 * is left to work out that they have been handed a duplicate. It is the most
 * common request and the one the build handled worst.
 *
 * So: if the trigger is already bound, and the description asks for a setting
 * that a step in the bound workflow actually declares, the answer is that
 * change. No model call, no new workflow, no duplicate.
 *
 * DELIBERATELY NARROW. This only resolves what it can be certain of — a numeric
 * setting, on a step that declares it, in a workflow already answering the
 * chosen trigger. Anything else falls through to generation, because a
 * confident wrong answer here means silently refusing to build something the
 * author actually asked for.
 */

export type ExistingNode = {
  id: string;
  impl: string;
  config?: Record<string, unknown>;
};

export type ConfigWanted = {
  field: string;
  value: number;
  /** The author's own words, for the ledger. */
  phrase: string;
};

export type ResolvedChange = {
  /** The step to change, by its id in the stored definition. */
  nodeId: string;
  impl: string;
  field: string;
  from: unknown;
  to: number;
  phrase: string;
};

export type Resolution =
  | {
      kind: "change";
      graphKey: string;
      version: number;
      changes: ResolvedChange[];
      /** One sentence for the top of the screen. */
      summary: string;
    }
  | {
      kind: "already-satisfied";
      graphKey: string;
      version: number;
      summary: string;
    }
  | { kind: "generate"; reason: string };

/**
 * Decide whether the request is answerable from an existing workflow.
 *
 * `generate` is not a failure — it is the honest answer whenever this cannot be
 * sure, and it is what the caller does anyway.
 */
export function resolveAgainstExisting(args: {
  /** The trigger the ranking chose, or null. */
  triggerEventType: string | null;
  /** Active event → graph key. */
  boundTo: ReadonlyMap<string, string>;
  /** The bound workflow's active definition, when there is one. */
  existing: {
    graphKey: string;
    version: number;
    nodes: readonly ExistingNode[];
  } | null;
  /** Settings read out of the description. */
  wanted: readonly ConfigWanted[];
  /** Node key → the config fields that step declares. */
  declaredFieldsOf: ReadonlyMap<string, readonly string[]>;
}): Resolution {
  if (!args.triggerEventType) {
    return { kind: "generate", reason: "No trigger was chosen." };
  }
  if (!args.boundTo.has(args.triggerEventType)) {
    return {
      kind: "generate",
      reason: `Nothing is bound to ${args.triggerEventType}, so there is no existing workflow to change.`,
    };
  }
  if (!args.existing || args.existing.nodes.length === 0) {
    return {
      kind: "generate",
      reason: "The bound workflow has no stored steps to change.",
    };
  }
  if (args.wanted.length === 0) {
    return {
      kind: "generate",
      reason:
        "The description asks for no setting this can recognise, so it may be " +
        "asking for different steps.",
    };
  }

  const changes: ResolvedChange[] = [];
  let matchedSomething = false;

  for (const want of args.wanted) {
    /**
     * Only a step that DECLARES the field. Stamping `matchThreshold` onto a
     * step whose schema has no such setting is how a graph gets a config key
     * nothing reads — it validates, it saves, and it changes nothing.
     */
    const targets = args.existing.nodes.filter((n) =>
      (args.declaredFieldsOf.get(n.impl) ?? []).includes(want.field),
    );
    if (targets.length === 0) continue;

    matchedSomething = true;
    for (const node of targets) {
      const current = node.config?.[want.field];
      // Already what they asked for. Not a change, and worth saying so rather
      // than offering a no-op edit.
      if (current === want.value) continue;
      changes.push({
        nodeId: node.id,
        impl: node.impl,
        field: want.field,
        from: current,
        to: want.value,
        phrase: want.phrase,
      });
    }
  }

  if (!matchedSomething) {
    return {
      kind: "generate",
      reason:
        "No step in the existing workflow declares the setting asked for, so " +
        "the request is probably about different steps.",
    };
  }

  if (changes.length === 0) {
    return {
      kind: "already-satisfied",
      graphKey: args.existing.graphKey,
      version: args.existing.version,
      summary:
        `${args.existing.graphKey} v${args.existing.version} already does this — ` +
        `every setting you asked for is the value it is already set to. Nothing needs building.`,
    };
  }

  const one = changes.length === 1 ? changes[0]! : null;
  return {
    kind: "change",
    graphKey: args.existing.graphKey,
    version: args.existing.version,
    changes,
    summary: one
      ? `This already runs. The only thing your request changes is ` +
        `${one.field} on ${one.nodeId}: ${JSON.stringify(one.from) ?? "unset"} → ${JSON.stringify(one.to)}.`
      : `This already runs. Your request changes ${changes.length} settings in ` +
        `${args.existing.graphKey} v${args.existing.version}.`,
  };
}
