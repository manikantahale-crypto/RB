/**
 * The router's decision, as a pure function.
 *
 * No database, no network, no clock, no randomness. Given the same event,
 * entitlements and table, it returns the same routes forever — which is what
 * makes routing simulation possible: CI can commit an expected outcome and
 * fail the PR when a change alters it.
 *
 * The DB lookup and the enqueueing stay in the worker. This file only decides.
 */
import type { BindingEntry, TargetKind } from "./binding.js";

/* ─────────────────────────────── types ───────────────────────────────── */

/** The parts of an event envelope routing is allowed to look at. */
export interface RoutableEvent {
  event_type: string;
  organization_id: string | null;
}

/** One thing the router should do. */
export interface Route {
  routingGroup: string;
  targetKind: TargetKind;
  priority: number;
  /** Present only for `graph` targets. */
  workflowKey?: string;
  /** Present only for `graph` targets. */
  moduleQueue?: string;
  inputMapping?: Record<string, string>;
  bindingId?: string;
  ownerModule: string;
}

export type RoutingErrorCode =
  | "ROUTING_AMBIGUOUS"
  | "ROUTING_GROUP_MODE_CONFLICT";

export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

/* ────────────────────────────── the resolver ─────────────────────────── */

/**
 * Every route that answers this event, in a stable order.
 *
 * An empty array is a valid answer and means nothing is bound. The caller
 * acknowledges the event and moves on; it must never fall back to code.
 */
export function resolveRoutes(
  event: RoutableEvent,
  entitlements: readonly string[],
  table: readonly BindingEntry[],
): Route[] {
  const held = new Set(entitlements);

  const matching = table.filter(
    (b) =>
      b.status === "ACTIVE" &&
      b.event_type === event.event_type &&
      (b.org_id === null || b.org_id === event.organization_id) &&
      b.conditions.requires_entitlement.every((e) => held.has(e)),
  );

  const routes: Route[] = [];

  for (const [group, entries] of groupBy(matching, (b) => b.routing_group)) {
    // A tenant-specific binding shadows the global one inside its own group.
    // Without this, a canary org would run both the canary and the default.
    const scoped = entries.some((b) => b.org_id !== null)
      ? entries.filter((b) => b.org_id !== null)
      : entries;

    const modes = new Set(scoped.map((b) => b.mode));
    if (modes.size > 1) {
      throw new RoutingError(
        "ROUTING_GROUP_MODE_CONFLICT",
        `routing group "${group}" has bindings declaring both "exclusive" and "fanout". ` +
          `A group is one or the other — the mode belongs to the group, and every ` +
          `binding in it must agree.`,
      );
    }

    const ordered = [...scoped].sort(byPriorityThenKey);

    if (scoped[0]?.mode === "exclusive") {
      // The database enforces one active binding per exclusive group. This is
      // the second line of defence: if two ever arrive, refuse rather than
      // silently pick one, because "silently picked one" is the exact failure
      // exclusivity exists to prevent.
      const winner = ordered[0]!;
      const tied = ordered.filter((b) => b.priority === winner.priority);
      if (tied.length > 1) {
        throw new RoutingError(
          "ROUTING_AMBIGUOUS",
          `exclusive routing group "${group}" has ${tied.length} active bindings ` +
            `sharing priority ${winner.priority} (${tied
              .map(describe)
              .join(", ")}). Priorities must be unique inside a group.`,
        );
      }
      routes.push(toRoute(winner));
    } else {
      for (const b of ordered) routes.push(toRoute(b));
    }
  }

  // Group order is alphabetical so the whole result is deterministic, not
  // dependent on the order rows came back from the table.
  return routes.sort(
    (a, b) =>
      a.routingGroup.localeCompare(b.routingGroup) ||
      a.priority - b.priority ||
      (a.workflowKey ?? "").localeCompare(b.workflowKey ?? ""),
  );
}

/* ──────────────────────────── input mapping ──────────────────────────── */

/**
 * Build one job payload from the envelope, using a binding's field adapter.
 *
 * `{ jobId: "payload_ref.requirement_id" }` reads that path off the envelope
 * and hands the node `{ jobId: <value> }`. This is what lets one graph answer
 * several events whose payloads name the same thing differently.
 *
 * A path that resolves to nothing is left out rather than set to undefined,
 * so the node's own input schema reports it as missing — one error, from the
 * contract that actually knows what the field is for.
 */
export function applyInputMapping(
  envelope: Record<string, unknown>,
  mapping: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!mapping) return {};
  const out: Record<string, unknown> = {};
  for (const [target, path] of Object.entries(mapping)) {
    const value = readPath(envelope, path);
    if (value !== undefined) out[target] = value;
  }
  return out;
}

/** Dot path read. Returns undefined for any missing or non-object step. */
export function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function toRoute(b: BindingEntry): Route {
  const route: Route = {
    routingGroup: b.routing_group,
    targetKind: b.target_kind,
    priority: b.priority,
    ownerModule: b.owner_module,
  };
  if (b.id !== undefined) route.bindingId = b.id;
  if (b.input_mapping !== undefined) route.inputMapping = b.input_mapping;
  if (b.target_kind === "graph") {
    route.workflowKey = b.workflow_key;
    route.moduleQueue = b.module_queue;
  }
  return route;
}

function byPriorityThenKey(a: BindingEntry, b: BindingEntry): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return describe(a).localeCompare(describe(b));
}

function describe(b: BindingEntry): string {
  return b.target_kind === "graph" ? b.workflow_key : b.target_kind;
}

function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}