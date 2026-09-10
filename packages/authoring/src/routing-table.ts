/**
 * `authoring.event_bindings` rows as the routing contract's binding table.
 *
 * WHY A MAPPER RATHER THAN ONE SHAPE
 *
 * `packages/routing-contract` is deliberately pure: no database, no network,
 * no clock. That is what makes routing simulatable — CI can commit an expected
 * outcome and fail the build when a change alters it. It therefore cannot read
 * a table, and something has to translate.
 *
 * THE ONE DECISION WORTH UNDERSTANDING: WHAT A ROUTING GROUP IS
 *
 * The contract groups bindings and applies `mode` inside each group:
 * `exclusive` fires one, `fanout` fires all. The database expresses the same
 * idea differently — a unique index on
 * (org_id, event_type, consuming_application) where status is active.
 *
 * These meet if **one group per consuming application**:
 *
 *   - inside a group, mode is `exclusive`, so one application answers an event
 *     with exactly one workflow. A second workflow in the same application is
 *     refused, because there the right answer is another node on the existing
 *     workflow, not a second binding.
 *   - `resolveRoutes` returns routes from EVERY group, so two applications
 *     answering the same fact produce two runs. That is fan-out, and it needs
 *     no `fanout` mode at all.
 *
 * So the database's unique index and the contract's exclusivity are the same
 * rule stated twice, and fan-out falls out of having more than one group.
 */
import type { BindingEntry } from "@tekisho/routing-contract";
import type { DbQueryable } from "./event-bindings.js";

/** One row of the join between bindings and the workflow they name. */
export interface BindingRow {
  id: string;
  org_id: string | null;
  event_type: string;
  graph_key: string | null;
  queue_key: string;
  consuming_application: string | null;
  priority: number;
  requires_feature: string | null;
  status: string;
}

/**
 * Rows to contract entries.
 *
 * Rows that cannot become a valid route are DROPPED rather than guessed at,
 * and the caller is told how many. A binding whose workflow no longer exists
 * has no `graph_key` after the join; enqueueing onto it would fail at run time
 * with a worse message than "this binding names nothing".
 */
export function toBindingEntries(rows: readonly BindingRow[]): {
  entries: BindingEntry[];
  dropped: BindingRow[];
} {
  const entries: BindingEntry[] = [];
  const dropped: BindingRow[] = [];

  for (const row of rows) {
    if (!row.graph_key || !row.queue_key) {
      dropped.push(row);
      continue;
    }

    // One group per application per event. See the header.
    const application = row.consuming_application ?? "platform";

    entries.push({
      id: row.id,
      event_type: row.event_type,
      routing_group: `${row.event_type}::${application}`,
      mode: "exclusive",
      priority: row.priority ?? 100,
      conditions: {
        requires_entitlement: row.requires_feature ? [row.requires_feature] : [],
      },
      org_id: row.org_id,
      status:
        row.status === "active"
          ? "ACTIVE"
          : row.status === "draft"
            ? "DRAFT"
            : "RETIRED",
      owner_module: application,
      target_kind: "graph",
      workflow_key: row.graph_key,
      module_queue: row.queue_key,
    } as BindingEntry);
  }

  return { entries, dropped };
}

/**
 * Read the active routing table.
 *
 * Only active rows: 461 of the 481 bindings are retired and they are history,
 * not routing. Draft bindings are excluded for the same reason — a trigger you
 * are still editing must not fire.
 */
export async function loadRoutingTable(db: DbQueryable): Promise<{
  entries: BindingEntry[];
  dropped: BindingRow[];
}> {
  const { rows } = await db.query<BindingRow>(
    `SELECT b.id::text,
            b.org_id::text,
            b.event_type,
            g.graph_key,
            b.queue_key,
            b.consuming_application,
            b.priority,
            b.requires_feature,
            b.status
       FROM authoring.event_bindings b
       LEFT JOIN authoring.graphs g ON g.id = b.graph_id
      WHERE b.status = 'active'`,
  );

  return toBindingEntries(rows);
}
