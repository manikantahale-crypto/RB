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
    | "routing_hazards"
    | "bindings_routable"
    | "impls_permitted"
    | "emitted_events_answered"
    | "live_means_reachable"
    | "work_not_duplicated";
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

export type QueueActivity = {
  /** Jobs sitting in `created`, waiting for somebody to take them. */
  waiting: number;
  /** Jobs currently being worked. Proof of a live consumer. */
  running: number;
  /** Seconds since the last completion on this queue, null if never. */
  secondsSinceCompletion: number | null;
};

export type RegistryRow = {
  key: string;
  module: string;
  shareable: boolean;
  /** Declared emits. Null means nobody has said, which is not the same as none. */
  emits: readonly (string | { fromConfig: string })[] | null;
};

export type PlatformFacts = {
  bindings: readonly BindingRow[];
  graphs: readonly ActiveGraphRow[];
  registry: readonly RegistryRow[];
  /**
   * What each module queue is actually doing, from `pgboss.job`.
   *
   * NOT a list of queue names. This check used to compare bindings against a
   * hardcoded array of five queues and reported five live bindings as dead —
   * every one of them a false finding, because the queues were being consumed
   * the whole time. A check that produces false findings is worse than no
   * check: people learn to scroll past it.
   */
  queueActivity: ReadonlyMap<string, QueueActivity>;
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
 * Check 1 — does anything about routing still surprise us?
 *
 * THIS CHECK USED TO ASK SOMETHING ELSE, AND THAT QUESTION IS NOW ANSWERED IN
 * THE CODE RATHER THAN HERE.
 *
 * It used to verify that every active binding's event was one the hardcoded
 * `PLATFORM_EVENT_PLAN` would send to a graph — because if it was not, the
 * event was acknowledged and dropped before the binding was ever read. Seven of
 * twenty live bindings failed that, two of them SYNTRA's own.
 *
 * That fault is fixed at the source: the relay now sends a bound event to the
 * ingress router whatever the map says, and the router resolves the binding
 * before consulting the map at all. A bound workflow runs. Leaving the old
 * assertion here would fail forever on a constraint that no longer exists,
 * which is how a suite teaches people to ignore it.
 *
 * What is worth checking is the hazard the fix introduces. `resume` events are
 * control-plane: `syntra.approval.decided` unparks a waiting human gate. Since
 * a bound event now ALSO reaches the router, binding a workflow to one means
 * two things happen — the thread resumes and a workflow starts. That is
 * sometimes wanted and never obvious, so it is named.
 */
export function checkEventsHandled(facts: PlatformFacts): CheckFinding {
  if (!facts.handlingOf) {
    return {
      id: "routing_hazards",
      status: "unchecked",
      message:
        "Not checked — nothing supplied how each event is handled, so a " +
        "control-plane collision cannot be spotted.",
      detail: [],
    };
  }

  const resumeCollisions = facts.bindings.filter(
    (b) => facts.handlingOf!.get(b.eventType) === "resume",
  );

  /**
   * Reported, not failed: proof the fix is doing something. These are the
   * bindings that would have been silently dropped under the old ordering.
   */
  const rescued = facts.bindings.filter((b) => {
    const kind = facts.handlingOf!.get(b.eventType);
    return kind !== undefined && kind !== "graph" && kind !== "resume";
  });

  const note = rescued.length
    ? ` ${rescued.length} binding${rescued.length === 1 ? "" : "s"} run only because the binding now wins over the event map.`
    : "";

  return resumeCollisions.length === 0
    ? {
        id: "routing_hazards",
        status: "pass",
        message: `No routing hazards across ${facts.bindings.length} active bindings.${note}`,
        detail: rescued.map(
          (b) =>
            `${b.eventType} → ${b.graphKey} (map says ${facts.handlingOf!.get(b.eventType)}; runs because it is bound)`,
        ),
      }
    : {
        id: "routing_hazards",
        status: "fail",
        message:
          `${resumeCollisions.length} binding${resumeCollisions.length === 1 ? "" : "s"} sit on a control-plane event. ` +
          `Those events resume a parked run, and a bound workflow now starts as well — two things happen, and only one of them is obvious.`,
        detail: resumeCollisions.map(
          (b) => `${b.eventType} → ${b.graphKey} (resumes a parked thread AND starts this workflow)`,
        ),
      };
}

/**
 * Check 2 — is work piling up on a queue nobody is collecting?
 *
 * A binding whose queue has no consumer is a door opening onto nothing: the
 * event is accepted by ingress, routed, stamped and enqueued, and then nobody
 * comes. Nothing fails, so nothing is reported.
 *
 * THIS ASKED THE WRONG QUESTION FIRST TIME, AND THE MISTAKE IS WORTH KEEPING
 * WRITTEN DOWN. It compared each binding's queue against a hardcoded array of
 * five names copied out of the engine, and reported five live bindings as dead.
 * All five were false: `module.relay` and `module.interview` were being
 * consumed the entire time — relay had completed a job sixteen seconds before
 * the check ran. The list was stale, and a list can only ever say what somebody
 * remembered to type.
 *
 * So it measures the symptom instead. Work waiting, nothing running, and
 * nothing completed for a long while is the shape of a queue with no consumer,
 * and it is true whoever is doing the consuming — including a service outside
 * this repository, which the hardcoded list could never have known about.
 *
 * A backlog on its own is NOT a fault. `module.syntra.match` had 1,688 jobs
 * waiting while actively working through them.
 */
const STALE_AFTER_SECONDS = 3600;

export function checkBindingsRoutable(facts: PlatformFacts): CheckFinding {
  if (facts.queueActivity.size === 0) {
    return {
      id: "bindings_routable",
      status: "unchecked",
      message:
        "Not checked — no queue activity was supplied, so a queue with no " +
        "consumer cannot be told apart from a quiet one.",
      detail: [],
    };
  }

  const bad: string[] = [];
  for (const b of facts.bindings) {
    if (!b.moduleQueue) {
      bad.push(`${b.eventType} → ${b.graphKey} names no queue at all`);
      continue;
    }
    const q = facts.queueActivity.get(b.moduleQueue);

    // No row at all means the queue has never had a job. Nothing is stuck, so
    // there is nothing to report — the first event will create it.
    if (!q) continue;

    const idle =
      q.secondsSinceCompletion === null ||
      q.secondsSinceCompletion > STALE_AFTER_SECONDS;

    if (q.waiting > 0 && q.running === 0 && idle) {
      bad.push(
        `${b.eventType} → ${b.graphKey} on ${b.moduleQueue}: ${q.waiting} waiting, ` +
          `none running, ` +
          (q.secondsSinceCompletion === null
            ? "nothing ever completed"
            : `nothing completed for ${Math.round(q.secondsSinceCompletion / 60)} minutes`),
      );
    }
  }

  return bad.length === 0
    ? {
        id: "bindings_routable",
        status: "pass",
        message: `All ${facts.bindings.length} active bindings sit on a queue something is working.`,
        detail: [],
      }
    : {
        id: "bindings_routable",
        status: "fail",
        message:
          `${bad.length} active binding${bad.length === 1 ? "" : "s"} route to a queue with work piling up and nobody collecting it. ` +
          `Those events are accepted and then sit, with no error.`,
        detail: bad,
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
      if (typeof ev === "string") {
        if (!bound.has(ev)) orphans.push(`${r.key} publishes ${ev} — nothing answers it`);
      } else if (typeof ev === "object" && ev !== null && "fromConfig" in ev) {
        const configKey = (ev as { fromConfig: string }).fromConfig;
        const knownDefaults: Record<string, string> = {
          onActionable: "syntra.jd.normalized",
          onRejected: "astra.requirement.rejected",
        };
        const resolved = knownDefaults[configKey];
        const eventLabel = resolved
          ? `${resolved} (fromConfig: "${configKey}")`
          : `{ fromConfig: "${configKey}" }`;
        const targetEvent = resolved ?? null;
        if (!targetEvent || !bound.has(targetEvent)) {
          orphans.push(`${r.key} publishes ${eventLabel} — nothing answers it`);
        }
      } else {
        orphans.push(`${r.key} publishes ${String(ev)} — nothing answers it`);
      }
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
/**
 * Check 5 — does "live" still mean reachable?
 *
 * Two tables record whether a workflow runs: a version is `live`, and a
 * binding is `active`. Both have to be true. They are written by different
 * code paths, so nothing but discipline keeps them together — and discipline
 * lost: thirteen workflows were live with no binding, including
 * `syntra.authored`, which had run 262 times and was last used on 1 September.
 *
 * Nobody decided to switch those off. `take-offline` retired the binding and
 * left the version alone, by design, and said so in its own response. Every
 * screen that reads "live" then reported them as running for weeks.
 *
 * This cannot be a database constraint: the two rows are in different tables,
 * so a CHECK cannot see across, and a trigger would fire mid-transaction
 * during approve-go-live, which legitimately writes both. V20260909.54
 * corrected the existing rows and both code paths are now transactional. This
 * is what notices if that ever stops being true.
 *
 * BOTH DIRECTIONS ARE FAULTS. A live version nothing can reach never runs; an
 * active binding with no live version is an event the router accepts and then
 * drops. The second is the quieter one.
 */
export function checkLiveMeansReachable(facts: PlatformFacts): CheckFinding {
  if (facts.graphs.length === 0) {
    return {
      id: "live_means_reachable",
      status: "unchecked",
      message:
        "Not checked — no live workflows were supplied, so an unreachable one " +
        "cannot be told apart from an empty platform.",
      detail: [],
    };
  }

  const boundKeys = new Set(facts.bindings.map((b) => b.graphKey));
  const liveKeys = new Set(facts.graphs.map((g) => g.graphKey));

  const unreachable = facts.graphs
    .filter((g) => !boundKeys.has(g.graphKey))
    .map((g) => `${g.graphKey} is live and no active binding points at it`);

  const dangling = facts.bindings
    .filter((b) => !liveKeys.has(b.graphKey))
    .map(
      (b) =>
        `${b.eventType} → ${b.graphKey} is bound, but that workflow has no live version`,
    );

  const bad = [...unreachable, ...dangling];

  return bad.length === 0
    ? {
        id: "live_means_reachable",
        status: "pass",
        message: `All ${facts.graphs.length} live workflows have a binding, and every binding points at a live workflow.`,
        detail: [],
      }
    : {
        id: "live_means_reachable",
        status: "fail",
        message:
          `${bad.length} workflow${bad.length === 1 ? "" : "s"} where "live" and "reachable" disagree. ` +
          `${unreachable.length} look live and can never fire; ` +
          `${dangling.length} accept events that are then dropped.`,
        detail: bad,
      };
}

/**
 * Check 6 — does one input get the same work done to it twice?
 *
 * THE SHAPE OF IT. A step publishes when it succeeds. If that event is bound
 * to another workflow, publishing starts that workflow as a separate run. So a
 * workflow containing both `syntra.jd.process` and `syntra.continuous.match`
 * matches twice for one requirement: once as its own next step, and once in
 * the workflow that `syntra.jd.parsed` set going. Two match jobs, two sets of
 * results, and nothing in any log that says so.
 *
 * WHY THIS IS A STANDING CHECK AND NOT A GO-LIVE GATE.
 *
 * The proposer already reports this for a workflow being authored, and the
 * gate could refuse one. Neither can catch the way it usually happens: the
 * workflow is fine on the day it ships, somebody binds that event to another
 * workflow NEXT WEEK, and a pair that never changed becomes duplicating. No
 * gate runs at that moment. Only something that keeps asking will notice.
 *
 * WHAT IT DOES NOT REPORT. A workflow reached by an event it publishes itself
 * — that is a self-trigger, a different and louder fault, already check 9 on
 * the go-live gate. Naming it here too would teach people to read past both.
 *
 * The honest answer when `emits` is undeclared is "unknown", never "none".
 * Every legacy step is undeclared, and treating silence as proof of innocence
 * is the exact mistake this file's header is about — so undeclared steps are
 * counted and named even when the check passes.
 */
export function checkWorkNotDuplicated(facts: PlatformFacts): CheckFinding {
  const emitsOf = new Map(facts.registry.map((r) => [r.key, r.emits]));
  const implsOf = new Map(facts.graphs.map((g) => [g.graphKey, g.impls]));
  const startedBy = new Map(facts.bindings.map((b) => [b.eventType, b.graphKey]));

  const duplicates: string[] = [];
  /** Steps in live workflows that have never said what they publish. */
  const undeclared = new Set<string>();
  /** Steps whose declaration we could read, so the check saw something. */
  let declaredSeen = 0;

  for (const graph of facts.graphs) {
    const here = new Set(graph.impls);

    for (const impl of graph.impls) {
      const declared = emitsOf.get(impl);
      if (declared == null) {
        undeclared.add(impl);
        continue;
      }
      declaredSeen += 1;

      for (const event of declared) {
        // A config-driven emit resolves against the step's settings, which a
        // graph row does not carry. Skip rather than guess at the event name.
        if (typeof event !== "string") continue;

        const started = startedBy.get(event);
        if (!started || started === graph.graphKey) continue;

        const alsoRuns = (implsOf.get(started) ?? []).filter((k) => here.has(k));
        if (alsoRuns.length === 0) continue;

        duplicates.push(
          `${graph.graphKey}: ${impl} publishes ${event}, which starts ` +
            `${started} — both run ${alsoRuns.join(", ")}, so one input is ` +
            `processed twice`,
        );
      }
    }
  }

  if (declaredSeen === 0) {
    return {
      id: "work_not_duplicated",
      status: "unchecked",
      message:
        "Not checked — no step in any live workflow has declared what it " +
        "publishes, so a duplicate cannot be told from a handoff.",
      detail: [...undeclared].sort().map((k) => `${k} declares no emits`),
    };
  }

  /**
   * Said on a pass as well as a failure. A pass here means "none of the steps
   * that have declared their emits duplicate work" — which is a smaller claim
   * than "no work is duplicated", and the difference is exactly the undeclared
   * list.
   */
  const caveat =
    undeclared.size > 0
      ? ` ${undeclared.size} step${undeclared.size === 1 ? "" : "s"} in live ` +
        `workflows have not declared what they publish and could not be checked.`
      : "";

  return duplicates.length === 0
    ? {
        id: "work_not_duplicated",
        status: "pass",
        message:
          `No live workflow runs a step that another workflow it starts also runs.${caveat}`,
        detail: [...undeclared].sort().map((k) => `${k} declares no emits`),
      }
    : {
        id: "work_not_duplicated",
        status: "fail",
        message:
          `${duplicates.length} case${duplicates.length === 1 ? "" : "s"} where one ` +
          `input has the same work done to it twice — once in a workflow, once in ` +
          `the workflow that workflow starts.${caveat}`,
        detail: duplicates,
      };
}

export function runPlatformChecks(facts: PlatformFacts): CheckFinding[] {
  return [
    checkBindingsRoutable(facts),
    checkImplsPermitted(facts),
    checkEmittedEventsAnswered(facts),
    checkEventsHandled(facts),
    checkLiveMeansReachable(facts),
    checkWorkNotDuplicated(facts),
  ];
}

/** True when nothing failed. Not-checked does not fail — it is reported. */
export function allPassed(findings: readonly CheckFinding[]): boolean {
  return findings.every((f) => f.status !== "fail");
}
