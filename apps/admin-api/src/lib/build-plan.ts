/**
 * The plan — what the author actually asked for, whole.
 *
 * THE UNIT OF WORK IS THE PLAN, NOT THE GRAPH.
 *
 * A request like "when a requirement arrives and finishes intake, match it at
 * 92" is an outcome, and an outcome is a chain of workflows joined by events.
 * Answering it with one application's graph and an apology in `unsupported[]`
 * is the wrong answer, however correct the architecture underneath is:
 * `unsupported` means "no node in the system can do this", and a handoff to
 * another application is the opposite — it means "this is already handled,
 * over there".
 *
 * So the plan draws every workflow the outcome passes through, says which
 * already exist, and names the event carrying work from each one to the next.
 *
 * WHY BOXES AND NOT ONE CANVAS. Drawing ASTRA's and SYNTRA's nodes on a single
 * canvas and cutting it at the boundary on save is appealing for about a
 * minute. It breaks on five things:
 *
 *   - versions: the workflows version independently (v3 and v119). What does
 *     one "publish" mean?
 *   - runs: one run per workflow, so a single edited picture produces three
 *     separate runs — two different stories about the same thing
 *   - failure: step 2 can fail after step 1 committed, minutes or days earlier,
 *     and there is no rollback across that
 *   - time: the gap between two boxes may be milliseconds or three days parked
 *     on a human gate; one canvas draws both the same
 *   - permission: a SYNTRA author may have no right to change ASTRA's workflow,
 *     and on one canvas that is invisible until save fails
 *
 * The seam is real, so it is visible. What it must not be is illegible — hence
 * a named event with its description and publish count on every link, rather
 * than a gap the author is left to infer.
 */

import { emitsEvent, type SplitStep } from "./split-cross-module.js";
import type { EmitDeclaration } from "@tekisho/node-contract";

/** What the catalogue knows about one event. */
export type EventFacts = {
  eventType: string;
  description: string | null;
  producedWhen: string | null;
  publishCount: number;
};

export type PlanStepState = "exists" | "new" | "blocked";

export type PlanStep = {
  seq: number;
  module: string;
  /** The workflow this step is, or would be. Null when blocked. */
  graphKey: string | null;
  /** Version of the existing workflow, null for a new one. */
  version: number | null;
  state: PlanStepState;
  /** True when this is the application the author was working in. */
  yours: boolean;
  /** Node keys, in run order. */
  steps: string[];
  /** Plain sentence for the box. */
  summary: string;
};

export type PlanLink = {
  fromSeq: number;
  toSeq: number;
  /** Null only when nothing can carry the work across. */
  eventType: string | null;
  description: string | null;
  producedWhen: string | null;
  publishCount: number;
  /** An active binding routes this event somewhere. */
  bound: boolean;
  /** A worker actually serves the queue that binding names. */
  routable: boolean;
  /**
   * Whether the step before this one can be seen to publish the event.
   *
   * Never "no" unless every node in that step has declared its emits — an
   * undeclared node is unknown, not silent. Reporting "will not hand off" on
   * an absent declaration would block chains that work.
   */
  emitted: "yes" | "no" | "unknown";
  blocked: boolean;
  /** Why it is blocked, in a sentence. Null when it is not. */
  reason: string | null;
};

export type Plan = {
  steps: PlanStep[];
  links: PlanLink[];
  /** True when nothing at all needs building — the outcome already exists. */
  satisfied: boolean;
  /** One sentence for the top of the screen. */
  verdict: string;
};

const titleOf = (module: string, steps: string[]) =>
  steps.length ? `${steps.length} step${steps.length === 1 ? "" : "s"}` : "no steps";

/**
 * Build the plan from a chain that has already been split by application.
 *
 * Everything here is derived. Nothing is stored, and nothing is modified — the
 * plan is what the author approves BEFORE anything happens, which is the whole
 * point of it existing separately from the graph.
 */
export function buildPlan(args: {
  /** One entry per application the outcome passes through, in order. */
  chain: Array<{
    module: string;
    yours: boolean;
    steps: string[];
    nodes: readonly SplitStep[];
    /** The handoff that starts this link. Null for the first. */
    startsWith: {
      fromModule: string;
      toModule: string;
      eventType: string;
      exists: boolean;
      handledBy: string | null;
    } | null;
    /** A live workflow already answers this link's trigger. */
    alreadyBuilt: string | null;
  }>;
  /** The trigger the author chose, for the first step. */
  triggerEventType: string | null;
  /** Event catalogue facts, by event type. */
  eventFacts: ReadonlyMap<string, EventFacts>;
  /** Active event → graph key. */
  boundTo: ReadonlyMap<string, string>;
  /** Active event → the queue its binding names. */
  queueOf: ReadonlyMap<string, string>;
  /** Queues a worker actually serves. */
  workedQueues: ReadonlySet<string>;
  /** Graph key → active version. */
  versionOf: ReadonlyMap<string, number>;
  /** Node key → declared emits, null when undeclared. */
  emitsOf: ReadonlyMap<string, EmitDeclaration[] | null>;
}): Plan {
  const steps: PlanStep[] = [];
  const links: PlanLink[] = [];

  args.chain.forEach((link, i) => {
    const seq = i + 1;
    const trigger = i === 0 ? args.triggerEventType : (link.startsWith?.eventType ?? null);

    /**
     * BLOCKED is decided by the link, not the step: a step is blocked when
     * nothing can carry work into it. The first step is never blocked — the
     * author chose its trigger.
     */
    const carried = i === 0 || Boolean(link.startsWith?.eventType);

    const graphKey = link.alreadyBuilt ?? null;
    const state: PlanStepState = !carried
      ? "blocked"
      : graphKey
        ? "exists"
        : "new";

    steps.push({
      seq,
      module: link.module,
      graphKey,
      version: graphKey ? (args.versionOf.get(graphKey) ?? null) : null,
      state,
      yours: link.yours,
      steps: [...link.steps],
      summary:
        state === "exists"
          ? `Already runs — ${graphKey}`
          : state === "blocked"
            ? "Nothing carries work into this application"
            : `To build — ${titleOf(link.module, link.steps)}`,
    });

    if (i === 0) return;

    const previous = args.chain[i - 1]!;
    const eventType = link.startsWith?.eventType ?? null;
    const facts = eventType ? args.eventFacts.get(eventType) : undefined;
    const queue = eventType ? args.queueOf.get(eventType) : undefined;

    /**
     * Does the step before this one publish the joining event?
     *
     * The single most useful warning on the screen, and the one that could not
     * be answered at all until nodes declared their emits. A chain whose join
     * nobody publishes fails in the worst possible way: the first workflow
     * succeeds, the second never starts, and nothing anywhere reports it.
     */
    const emitted = eventType
      ? emitsEvent({
          nodes: previous.nodes,
          eventType,
          emitsOf: args.emitsOf,
        })
      : "no";

    const bound = eventType ? args.boundTo.has(eventType) : false;
    const routable = queue ? args.workedQueues.has(queue) : false;

    let reason: string | null = null;
    if (!eventType) {
      reason =
        `No event carries ${previous.module.toUpperCase()} to ` +
        `${link.module.toUpperCase()}. A developer must add a node that publishes ` +
        `a bridging event and register it in the catalogue.`;
    } else if (emitted === "no") {
      reason =
        `Nothing in ${previous.module.toUpperCase()}'s steps publishes ` +
        `${eventType}, and every step there has declared what it publishes. ` +
        `The next step would never start.`;
    } else if (bound && !routable) {
      reason =
        `${eventType} is bound, but its queue${queue ? ` (${queue})` : ""} is not ` +
        `served by any worker. Events reaching it are accepted and then dropped.`;
    }

    links.push({
      fromSeq: seq - 1,
      toSeq: seq,
      eventType,
      description: facts?.description ?? null,
      producedWhen: facts?.producedWhen ?? null,
      publishCount: facts?.publishCount ?? 0,
      bound,
      routable,
      emitted,
      blocked: !eventType || emitted === "no",
      reason,
    });
  });

  /**
   * Mark a step blocked when the link into it is. Decided after the loop
   * because a link is what blocks a step, and the link is built second.
   */
  for (const l of links) {
    if (!l.blocked) continue;
    const s = steps.find((x) => x.seq === l.toSeq);
    if (s) {
      s.state = "blocked";
      s.summary = l.reason ?? "Nothing carries work into this application";
    }
  }

  const toBuild = steps.filter((s) => s.state === "new");
  const blocked = steps.filter((s) => s.state === "blocked");
  const satisfied = toBuild.length === 0 && blocked.length === 0;

  let verdict: string;
  if (blocked.length > 0) {
    verdict =
      `This cannot run as described: ${blocked.length} step` +
      `${blocked.length === 1 ? "" : "s"} ${blocked.length === 1 ? "has" : "have"} ` +
      `nothing carrying work into ${blocked.length === 1 ? "it" : "them"}.`;
  } else if (satisfied) {
    verdict =
      "Everything you described already runs. Nothing needs building — open a " +
      "step to change how it behaves.";
  } else {
    verdict =
      `${toBuild.length} of ${steps.length} step${steps.length === 1 ? "" : "s"} ` +
      `need${toBuild.length === 1 ? "s" : ""} building. The rest already run.`;
  }

  return { steps, links, satisfied, verdict };
}
