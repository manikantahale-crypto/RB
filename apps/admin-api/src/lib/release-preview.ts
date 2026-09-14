/**
 * What approving this version would change about routing.
 *
 * THE QUESTION AN APPROVER ACTUALLY HAS.
 *
 * The go-live queue can say "syntra.match.workflow v7 is waiting, requested by
 * alice". It cannot say what happens when you press the button, and that is
 * the only thing the person pressing it needs to know: which events start
 * going somewhere new, and what stops receiving them.
 *
 * WHY THIS CAN BE ANSWERED HONESTLY.
 *
 * `resolveRoutes` is pure — no database, no clock, no randomness. Given an
 * event, the entitlements held, and a binding table, it returns the routes and
 * nothing else. So the same function the router uses in production can be run
 * twice here, against the table as it is and the table as approval would leave
 * it, and the difference between the two answers is not an estimate. It is the
 * decision the router will make.
 *
 * That is the whole reason the spec insists the resolver stay pure. Anything
 * that reached for a connection would make this a mock of routing rather than
 * routing.
 *
 * WHAT THE SIMULATION DOES NOT KNOW.
 *
 * Entitlements are per-organisation and this asks the global question, so a
 * binding gated on one is reported as reachable. The screen says so rather
 * than quietly assuming: a route that depends on an entitlement is flagged,
 * because "it would route" and "it would route for everybody" are different
 * claims and only one of them is being made.
 */

import { resolveRoutes, type BindingEntry, type Route } from "@tekisho/routing-contract";

/** One binding as the authoring tables store it. */
export type StoredBinding = {
  id: string;
  eventType: string;
  orgId: string | null;
  graphKey: string;
  queueKey: string | null;
  consumingApplication: string | null;
  priority: number | null;
  requiresFeature: string[] | null;
  status: string;
};

/**
 * The authoring row, as the routing contract wants it.
 *
 * `routing_group` is not a column. The group is `(org, event_type,
 * consuming_application)` by design — one active binding per triple, and
 * fan-out emerging across groups rather than inside one — so the consuming
 * application IS the group, and inventing a column for it would give two
 * places to disagree about the same fact.
 */
export function toBindingEntry(b: StoredBinding): BindingEntry {
  const group = b.consumingApplication ?? "platform";
  return {
    id: b.id,
    event_type: b.eventType,
    routing_group: group,
    mode: "exclusive",
    priority: b.priority ?? 100,
    conditions: { requires_entitlement: b.requiresFeature ?? [] },
    org_id: b.orgId,
    status: b.status.toUpperCase() === "ACTIVE" ? "ACTIVE" : "RETIRED",
    owner_module: group,
    target_kind: "graph",
    workflow_key: b.graphKey,
    module_queue: b.queueKey ?? `module.${group}`,
  } as BindingEntry;
}

export type RouteChange = {
  eventType: string;
  /** Where this event goes today. */
  before: Array<{ workflowKey: string; group: string; gatedOn: string[] }>;
  /** Where it would go once this version is approved. */
  after: Array<{ workflowKey: string; group: string; gatedOn: string[] }>;
  /** Workflows that stop receiving this event. */
  losing: string[];
  /** Workflows that start receiving it. */
  gaining: string[];
};

const shape = (r: Route) => ({
  workflowKey: r.workflowKey ?? `(${r.targetKind})`,
  group: r.routingGroup,
  gatedOn: [] as string[],
});

/**
 * Route this event before and after, and say what moved.
 *
 * `approving` is the binding approval would create. It replaces any active
 * binding in the same group — which is what `upsertActiveEventBinding` does in
 * the same transaction as the promotion, so the simulation and the act agree.
 */
export function previewRelease(args: {
  eventType: string;
  orgId: string | null;
  current: readonly StoredBinding[];
  approving: StoredBinding;
  /** Entitlements to assume. Empty means "only ungated routes are shown". */
  entitlements?: readonly string[];
}): RouteChange {
  const held = args.entitlements ?? [];
  const event = { event_type: args.eventType, organization_id: args.orgId };

  const activeNow = args.current.filter(
    (b) => b.status.toUpperCase() === "ACTIVE",
  );

  const group = args.approving.consumingApplication ?? "platform";
  const afterRows = [
    // Everything except the binding this approval replaces. Same rule the
    // write path uses: one active binding per (org, event, application).
    ...activeNow.filter(
      (b) =>
        !(
          b.eventType === args.approving.eventType &&
          (b.consumingApplication ?? "platform") === group &&
          b.orgId === args.approving.orgId
        ),
    ),
    { ...args.approving, status: "ACTIVE" },
  ];

  const table = activeNow.map(toBindingEntry);
  const afterTable = afterRows.map(toBindingEntry);

  const before = resolveRoutes(event, held, table).map(shape);
  const after = resolveRoutes(event, held, afterTable).map(shape);

  /**
   * Gated routes are reported, not hidden.
   *
   * `resolveRoutes` drops a binding whose entitlement is not held, and this
   * asks the global question with none held. A binding that requires one would
   * therefore vanish from both sides and read as "nothing changes" — so the
   * gate is named on the route instead of silently removing it.
   */
  const gatesOf = (rows: readonly StoredBinding[]) =>
    new Map(
      rows
        .filter((b) => (b.requiresFeature ?? []).length > 0)
        .map((b) => [b.graphKey, b.requiresFeature ?? []]),
    );
  const beforeGates = gatesOf(activeNow);
  const afterGates = gatesOf(afterRows);
  for (const r of before) r.gatedOn = beforeGates.get(r.workflowKey) ?? [];
  for (const r of after) r.gatedOn = afterGates.get(r.workflowKey) ?? [];

  const beforeKeys = new Set(before.map((r) => r.workflowKey));
  const afterKeys = new Set(after.map((r) => r.workflowKey));

  return {
    eventType: args.eventType,
    before,
    after,
    losing: [...beforeKeys].filter((k) => !afterKeys.has(k)),
    gaining: [...afterKeys].filter((k) => !beforeKeys.has(k)),
  };
}
