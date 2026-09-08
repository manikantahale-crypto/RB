/**
 * Four questions that say whether the platform is telling the truth.
 *
 * Not "is it finished" — "does what it claims match what it does". Every one of
 * these is answerable from the database, none of them was being asked, and each
 * has been quietly false for some time:
 *
 *   - five active bindings route to queues no worker serves. Those events are
 *     accepted, routed, enqueued, and never picked up.
 *   - nineteen steps in active graphs are in no palette; thirteen are in no
 *     registry at all, including `orch.switch`, which appears in four of them.
 *
 * Both were found by running these by hand. Neither would have survived a week
 * of this file existing.
 *
 * THE RULE THROUGHOUT: a check that cannot see reports NOT CHECKED, never a
 * pass. Absent evidence has read as success three separate times in this
 * codebase — an empty payload schema, a module with no nodes, an unprefixed
 * graph key — and each time the check went quiet exactly where it mattered.
 */

export type CheckStatus = "pass" | "fail" | "unchecked";

export type CheckFinding = {
  id:
    | "events_handled"
    | "bindings_routable"
    | "impls_permitted"
    | "emitted_events_answered";
  status: CheckStatus;
  /** One sentence, true whichever way it went. */
  message: string;
  /** The specific rows at fault, for someone about to fix them. */
  detail: string[];
};

export type BindingRow = {
  eventType: string;
  graphKey: string;
  moduleQueue: string | null;
};

export type ActiveGraphRow = {
  graphKey: string;
  /** Node keys used by the active definition. */
  impls: readonly string[];
};

export type RegistryRow = {
  key: string;
  module: string;
  shareable: boolean;
  /** Declared emits. Null means nobody has said, which is not the same as none. */
  emits: readonly string[] | null;
};

export type PlatformFacts = {
  bindings: readonly BindingRow[];
  graphs: readonly ActiveGraphRow[];
  registry: readonly RegistryRow[];
  /** Queues a worker actually serves. */
  workedQueues: ReadonlySet<string>;
  /** Applications the platform knows about. */
  modules: readonly string[];
  /**
   * event type → its declared handling, when the catalogue records one.
   *
   * Absent entirely today: `event_schemas` has no `handling` column. The check
   * says so rather than passing.
   */
  handlingOf: ReadonlyMap<string, string> | null;
};

/**
 * Check 1 — every active binding's event is declared as one that starts a graph.
 *
 * Unanswerable until `event_schemas` gains a `handling` column. Reported as not
 * checked, which is the honest state: seven events in the catalogue have no
 * handling at all and two of them carry live bindings, and none of that is
 * visible from here yet.
 */
export function checkEventsHandled(facts: PlatformFacts): CheckFinding {
  if (!facts.handlingOf) {
    return {
      id: "events_handled",
      status: "unchecked",
      message:
        "Not checked — the event catalogue does not record how an event is " +
        "handled, so there is nothing to compare a binding against.",
      detail: [],
    };
  }
  const bad = facts.bindings.filter(
    (b) => facts.handlingOf!.get(b.eventType) !== "graph",
  );
  return bad.length === 0
    ? {
        id: "events_handled",
        status: "pass",
        message: `All ${facts.bindings.length} active bindings start an event declared as handled by a graph.`,
        detail: [],
      }
    : {
        id: "events_handled",
        status: "fail",
        message: `${bad.length} active binding${bad.length === 1 ? "" : "s"} name an event the catalogue does not say a graph handles.`,
        detail: bad.map(
          (b) =>
            `${b.eventType} → ${b.graphKey} (handling: ${facts.handlingOf!.get(b.eventType) ?? "none"})`,
        ),
      };
}

/**
 * Check 2 — every active binding sits on a queue a worker actually serves.
 *
 * A binding naming an unworked queue is a door opening onto nothing. The event
 * is accepted by ingress, routed, and enqueued — and then nobody comes. There
 * is no error anywhere, because nothing failed; work simply stops.
 */
export function checkBindingsRoutable(facts: PlatformFacts): CheckFinding {
  if (facts.workedQueues.size === 0) {
    return {
      id: "bindings_routable",
      status: "unchecked",
      message: "Not checked — no list of served queues was supplied.",
      detail: [],
    };
  }
  const bad = facts.bindings.filter(
    (b) => !b.moduleQueue || !facts.workedQueues.has(b.moduleQueue),
  );
  return bad.length === 0
    ? {
        id: "bindings_routable",
        status: "pass",
        message: `All ${facts.bindings.length} active bindings sit on a queue a worker serves.`,
        detail: [],
      }
    : {
        id: "bindings_routable",
        status: "fail",
        message:
          `${bad.length} active binding${bad.length === 1 ? "" : "s"} route to a queue nothing serves. ` +
          `Those events are accepted and then dropped, with no error.`,
        detail: bad.map(
          (b) => `${b.eventType} → ${b.graphKey} on ${b.moduleQueue ?? "(no queue)"}`,
        ),
      };
}

/**
 * Which application owns a workflow, or null.
 *
 * The first segment of the key IF it names a real application. Splitting on a
 * dot and trusting the result read `duplicate.review` as belonging to an
 * application called "duplicate", which made every SYNTRA step inside it look
 * like a boundary crossing. A check producing false findings is worse than no
 * check, because people learn to ignore it.
 */
function moduleOfGraph(graphKey: string, modules: readonly string[]): string | null {
  const head = graphKey.split(".")[0] ?? "";
  return modules.includes(head) ? head : null;
}

/**
 * Check 3 — every step in an active graph is one that graph could be offered.
 *
 * Two ways to fail, and they are different problems. A step in NO registry
 * cannot be validated, tested, or shown in a palette — nobody knows what it
 * takes or returns. A step belonging to another application without
 * `shareable` is a boundary crossing: it runs under its owner's database role,
 * and its owner has not agreed to that.
 */
export function checkImplsPermitted(facts: PlatformFacts): CheckFinding {
  if (facts.registry.length === 0) {
    return {
      id: "impls_permitted",
      status: "unchecked",
      message: "Not checked — the node registry is empty.",
      detail: [],
    };
  }
  const byKey = new Map(facts.registry.map((r) => [r.key, r] as const));
  const unknown: string[] = [];
  const borrowed: string[] = [];

  for (const g of facts.graphs) {
    const owner = moduleOfGraph(g.graphKey, facts.modules);
    for (const impl of new Set(g.impls)) {
      const row = byKey.get(impl);
      if (!row) {
        unknown.push(`${g.graphKey} uses ${impl} — not in the registry`);
        continue;
      }
      // Unattributable key: reporting every step as a crossing would be noise.
      if (owner === null) continue;
      if (row.module !== owner && !row.shareable) {
        borrowed.push(
          `${g.graphKey} uses ${impl}, owned by ${row.module} and not shareable`,
        );
      }
    }
  }

  const detail = [...unknown, ...borrowed];
  return detail.length === 0
    ? {
        id: "impls_permitted",
        status: "pass",
        message: `Every step in all ${facts.graphs.length} active graphs is in a palette that graph would be offered.`,
        detail: [],
      }
    : {
        id: "impls_permitted",
        status: "fail",
        message:
          `${unknown.length} step reference${unknown.length === 1 ? "" : "s"} in no registry, ` +
          `${borrowed.length} borrowed without permission.`,
        detail,
      };
}

/**
 * Check 4 — every event a step publishes is answered by something.
 *
 * Newly answerable: it needs nodes to declare what they emit, which they now
 * do. An emitted event with no binding is a chain that stops — sometimes
 * correctly, because plenty of events go to a screen or an audit trail rather
 * than to a workflow. So this reports rather than condemns, and only counts
 * events the CATALOGUE knows about: an emit naming an event nobody registered
 * is a different fault, caught by check 1 once handling lands.
 */
export function checkEmittedEventsAnswered(facts: PlatformFacts): CheckFinding {
  const declared = facts.registry.filter((r) => r.emits !== null);
  if (declared.length === 0) {
    return {
      id: "emitted_events_answered",
      status: "unchecked",
      message:
        "Not checked — no node has declared what it publishes, so there is " +
        "nothing to trace. Re-materialise the node registry.",
      detail: [],
    };
  }

  const bound = new Set(facts.bindings.map((b) => b.eventType));
  const orphans: string[] = [];
  for (const r of declared) {
    for (const ev of r.emits!) {
      if (!bound.has(ev)) orphans.push(`${r.key} publishes ${ev} — nothing answers it`);
    }
  }

  const covered = declared.length;
  return orphans.length === 0
    ? {
        id: "emitted_events_answered",
        status: "pass",
        message: `Every event published by the ${covered} nodes that declare their emits is answered by an active binding.`,
        detail: [],
      }
    : {
        id: "emitted_events_answered",
        status: "fail",
        message:
          `${orphans.length} published event${orphans.length === 1 ? "" : "s"} nothing answers. ` +
          `Some of those are correct — an event may go to a screen rather than a workflow — so read the list.`,
        detail: orphans,
      };
}

/** All four, in the order they are worth reading. */
export function runPlatformChecks(facts: PlatformFacts): CheckFinding[] {
  return [
    checkBindingsRoutable(facts),
    checkImplsPermitted(facts),
    checkEmittedEventsAnswered(facts),
    checkEventsHandled(facts),
  ];
}

/** True when nothing failed. Not-checked does not fail — it is reported. */
export function allPassed(findings: readonly CheckFinding[]): boolean {
  return findings.every((f) => f.status !== "fail");
}
