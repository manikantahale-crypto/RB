import type { Pool, PoolClient, QueryResultRow } from "pg";
import { getTriggerEvent } from "./trigger-events.js";

export type DbQueryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

export type EventBindingRow = {
  id: string;
  event_type: string;
  org_id: string | null;
  graph_key: string;
  module_queue: string;
  version: number | null;
  status: string;
  source: string;
};

/** One projection, so the org-scoped and global reads cannot drift apart. */
const BINDING_SELECT = `
  SELECT b.id::text AS id, b.event_type, b.org_id::text AS org_id,
         g.graph_key, b.queue_key AS module_queue,
         v.version, b.status, b.source
    FROM authoring.event_bindings b
    JOIN authoring.graphs g ON g.id = b.graph_id
    LEFT JOIN authoring.graph_versions v ON v.id = b.pinned_version_id`;

/**
 * Resolve the active binding for ingress. Prefers the org-scoped row, else the
 * global one (org_id IS NULL). Returns null when nothing is active — the
 * caller must NOT fall back to code.
 *
 * The binding is a row in `authoring.event_bindings`, presented under the
 * names the callers already use.
 *
 * Three columns are reassembled rather than stored: `graph_key` comes from
 * `authoring.graphs`, `module_queue` is `queue_key`, and `version` is the
 * number of the pinned version, or NULL for a binding that follows whichever
 * version is live.
 *
 * `agent_id` IS GONE, AND THAT IS THE POINT.
 *
 * A binding used to name the agent that authored it, because Builder's unit of
 * authorship was an agent. The unit is now a workflow, and the new table has
 * no agent column on purpose: the agent_* model is being retired with the old
 * project, and giving it a column here would carry it forward.
 *
 * The one rule that read it — an agent may replace its own binding without a
 * confirmation — is now matched on the graph key, which was already the half
 * of that rule doing the work. See the note on `sameOwner` below.
 *
 * The legacy public.graph_event_bindings is kept in step by the mirror in
 * V20260909.36, so RELAY, INTERVIEW and node-api's activity screen still
 * resolve while they are on the old table.
 */
export async function resolveActiveEventBinding(
  db: DbQueryable,
  eventType: string,
  organizationId?: string | null,
): Promise<EventBindingRow | null> {
  if (organizationId) {
    const org = await db.query<EventBindingRow & QueryResultRow>(
      `${BINDING_SELECT}
        WHERE b.event_type = $1
          AND b.org_id = $2::uuid
          AND b.status = 'active'
        LIMIT 1`,
      [eventType, organizationId],
    );
    if (org.rows[0]) return normalize(org.rows[0]);
  }

  const global = await db.query<EventBindingRow & QueryResultRow>(
    `${BINDING_SELECT}
      WHERE b.event_type = $1
        AND b.org_id IS NULL
        AND b.status = 'active'
      LIMIT 1`,
    [eventType],
  );
  return global.rows[0] ? normalize(global.rows[0]) : null;
}

function normalize(row: EventBindingRow & QueryResultRow): EventBindingRow {
  return {
    id: String(row.id),
    event_type: String(row.event_type),
    org_id: row.org_id == null ? null : String(row.org_id),
    graph_key: String(row.graph_key),
    module_queue: String(row.module_queue),
    version: row.version == null ? null : Number(row.version),
    status: String(row.status),
    source: String(row.source),
  };
}

export class EventAlreadyBoundError extends Error {
  readonly code = "EVENT_ALREADY_BOUND";
  constructor(
    public readonly eventType: string,
    public readonly existingGraphKey: string,
    /** Where the current holder came from: a migration, or somebody authoring. */
    public readonly existingSource: string = "authoring",
  ) {
    super(
      `Event "${eventType}" is already bound to graph "${existingGraphKey}"` +
        (existingSource === "seed"
          ? `. That binding was created by a migration and is what runs in ` +
            `production today — taking it over stops "${existingGraphKey}" ` +
            `from running at all. Confirm the takeover, or trigger this ` +
            `workflow from a different event.`
          : `. Retire or rebind that workflow before activating another.`),
    );
    this.name = "EventAlreadyBoundError";
  }
}

/**
 * Which queue an event's work should go to, when nothing has said.
 *
 * Only reached for an event outside the hardcoded catalogue — one somebody
 * registered themselves. Three steps, most specific first:
 *
 *   1. what another event from the same application already uses. If SYNTRA's
 *      other triggers go to `module.syntra.jd`, a new SYNTRA trigger belongs
 *      with them rather than on a queue of its own.
 *   2. `module.<application>`, derived from the event's prefix.
 *   3. `module.default`, if the event name has no prefix at all.
 *
 * A derived name is safe to invent NOW and was not before: the module worker
 * used to subscribe to five hardcoded queues, so a binding naming anything
 * else was a door onto nothing. It now subscribes to whatever queues active
 * bindings name, so a queue invented here is served from the next restart.
 */
async function deriveModuleQueue(
  client: DbQueryable,
  eventType: string,
): Promise<string> {
  const application = eventType.split(".")[0] ?? "";

  if (application) {
    const { rows } = await client.query<{ module_queue: string }>(
      `SELECT queue_key AS module_queue, count(*) AS n
         FROM authoring.event_bindings
        WHERE status = 'active'
          AND event_type LIKE $1
        GROUP BY queue_key
        ORDER BY n DESC
        LIMIT 1`,
      [`${application}.%`],
    );
    if (rows[0]?.module_queue) return rows[0].module_queue;
  }

  return application ? `module.${application}` : "module.default";
}

/**
 * Activate authoring binding: retire other active rows for this event+scope,
 * insert/update this agent's binding. Same agent may replace its own binding.
 *
 * TAKING AN EVENT OVER IS NEVER SILENT.
 *
 * One event starts exactly one workflow — `graph_event_bindings_one_active`
 * makes it a unique index — so binding an event somebody else holds does not
 * add a listener, it REPLACES them. The workflow that used to answer that
 * event stops running, and nothing about that is visible: no failed run, no
 * error, no alert. Whatever it did just quietly stops happening.
 *
 * This used to refuse only when the current holder was authored. Every binding
 * that ASTRA, SYNTRA and ORBIT actually run on came from a migration, so the
 * bindings with real work behind them were the ones it would silently retire —
 * exactly backwards. A seeded holder is now protected at least as well as an
 * authored one.
 *
 * `allowTakeover` is how somebody says yes on purpose. It exists because
 * replacing a seeded workflow is a legitimate thing to do eventually; it just
 * should not be something you discover afterwards.
 */
export async function upsertActiveEventBinding(
  // Not `PoolClient | DbQueryable`: a union of two call signatures is not
  // callable, which is what made three lines below fail to typecheck.
  // PoolClient already satisfies DbQueryable structurally.
  client: DbQueryable,
  args: {
    eventType: string;
    orgId: string | null;
    graphKey: string;
    moduleQueue?: string;
    version: number;
    /**
     * Take the event from whoever holds it, stopping their workflow.
     * Only ever set from an explicit, informed confirmation.
     */
    allowTakeover?: boolean;
  },
): Promise<EventBindingRow> {
  /**
   * THE CATALOGUE DECIDES WHAT IS A VALID TRIGGER, NOT A HARDCODED LIST.
   *
   * This used to be `getTriggerEvent(eventType)` and a throw. That list holds
   * eighteen events; `event_schemas` holds forty-five. So registering a new
   * event and binding a workflow to it failed with
   * `Unknown trigger event_type` — and the only fix was an authoring release.
   *
   * That was the third of three places onboarding a module cost a deploy. The
   * other two were the router's event map and the worker's queue list.
   *
   * The hardcoded entry is still consulted FIRST, because it carries a
   * `moduleQueue` chosen deliberately (`module.design.resume` is not derivable
   * from `syntra.resume.received`). It is now a source of defaults rather than
   * a gate.
   */
  const trigger = getTriggerEvent(args.eventType);
  let moduleQueue = args.moduleQueue ?? trigger?.moduleQueue;

  if (!moduleQueue) {
    const { rows: known } = await client.query(
      `SELECT 1 FROM authoring.event_catalog WHERE event_type = $1 LIMIT 1`,
      [args.eventType],
    );
    if (known.length === 0) {
      throw new Error(
        `Unknown event type: ${args.eventType}. Register it in the event ` +
          `catalogue before binding a workflow to it.`,
      );
    }
    moduleQueue = await deriveModuleQueue(client, args.eventType);
  }

  const orgId = args.orgId;

  const existing = await resolveActiveEventBinding(client, args.eventType, orgId);

  /**
   * Replacing your own binding is not a takeover.
   *
   * The owner is the workflow. This used to also match on the agent id, and
   * that half never decided anything the graph key had not already decided:
   * an authored workflow re-activating over its own seeded row is the same
   * workflow getting a new version — the common case, and refusing it would
   * make every seeded workflow permanently unpublishable.
   */
  const sameOwner = existing !== null && existing.graph_key === args.graphKey;

  if (existing && !sameOwner && !args.allowTakeover) {
    throw new EventAlreadyBoundError(
      args.eventType,
      existing.graph_key,
      existing.source,
    );
  }

  /**
   * The workflow this binding points at has to exist before the binding can.
   *
   * A binding naming a workflow nobody has authored was representable in the
   * old table — graph_key was just text — and it is not here, because
   * `graph_id` is a foreign key. That is the point: the two ways a binding
   * could silently do nothing were a queue nothing served and a graph key
   * nothing matched, and both are now constraints rather than surprises.
   */
  const { rows: graphRows } = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM authoring.graphs
      WHERE graph_key = $1
        AND org_id IS NOT DISTINCT FROM $2::uuid
      LIMIT 1`,
    [args.graphKey, orgId],
  );
  const graphId = graphRows[0]?.id;
  if (!graphId) {
    throw new Error(
      `No workflow named "${args.graphKey}" in this scope. Save it before ` +
        `binding an event to it.`,
    );
  }

  /**
   * The queue is a foreign key too, and a queue nobody has declared is exactly
   * how RELAY's bindings ended up on doors onto nothing. Declaring it here is
   * safe now that the module worker subscribes to whatever queues active
   * bindings name.
   */
  await client.query(
    `INSERT INTO platform.queues (key, description)
     VALUES ($1, 'Declared by a binding')
     ON CONFLICT (key) DO NOTHING`,
    [moduleQueue],
  );

  // Retire all active for this event+scope (including seed) before insert.
  if (orgId === null) {
    await client.query(
      `UPDATE authoring.event_bindings
          SET status = 'retired', updated_at = now()
        WHERE event_type = $1
          AND org_id IS NULL
          AND status = 'active'`,
      [args.eventType],
    );
  } else {
    await client.query(
      `UPDATE authoring.event_bindings
          SET status = 'retired', updated_at = now()
        WHERE event_type = $1
          AND org_id = $2::uuid
          AND status = 'active'`,
      [args.eventType, orgId],
    );
  }

  const inserted = await client.query<EventBindingRow & QueryResultRow>(
    `WITH pinned AS (
       SELECT v.id FROM authoring.graph_versions v
        WHERE v.graph_id = $3::uuid AND v.version = $5
     ), inserted AS (
       INSERT INTO authoring.event_bindings (
         event_type, org_id, graph_id, queue_key, consuming_application,
         pinned_version_id, status, source
       )
       SELECT $1, $2::uuid, $3::uuid, $4,
              (SELECT q.application FROM platform.queues q WHERE q.key = $4),
              (SELECT id FROM pinned),
              'active', 'authoring'
       RETURNING id, event_type, org_id, graph_id, queue_key,
                 pinned_version_id, status, source
     )
     SELECT i.id::text AS id, i.event_type, i.org_id::text AS org_id,
            g.graph_key, i.queue_key AS module_queue,
            v.version, i.status, i.source
       FROM inserted i
       JOIN authoring.graphs g ON g.id = i.graph_id
       LEFT JOIN authoring.graph_versions v ON v.id = i.pinned_version_id`,
    [args.eventType, orgId, graphId, moduleQueue, args.version],
  );

  /**
   * A bound event is a routed event.
   *
   * `handling` is what the router consults to decide whether an event starts a
   * workflow or is merely acknowledged, and a newly registered event defaults
   * to `terminal`. Binding a workflow to it is precisely the act that makes it
   * `graph` — so the promotion happens here, in the same transaction, rather
   * than being a second thing somebody has to remember.
   */
  await client.query(
    `UPDATE authoring.event_catalog
        SET handling = 'graph', updated_at = now()
      WHERE event_type = $1 AND handling <> 'graph'`,
    [args.eventType],
  );

  return normalize(inserted.rows[0]!);
}

/**
 * Check the bindings table is there, then seed day-1 bindings.
 *
 * It used to create the table and its indexes too, for a local boot without
 * Flyway. That is exactly the drift this codebase has been unwinding: the
 * one-active index decides what routes, so a second definition of it is a
 * second definition of the routing rule.
 */
export async function ensureEventBindingsSchema(pool: Pool): Promise<void> {
  // Built by packages/db/migrations. Creating it here would make this a
  // second author of the schema — and this table in particular carries the
  // one-active index that decides what routes, so two definitions of it is
  // two definitions of the routing rule.
  const { rows } = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('authoring.event_bindings') IS NOT NULL AS present`,
  );
  if (!rows[0]?.present) {
    throw new Error(
      "[authoring] authoring.event_bindings is missing. Apply " +
        "packages/db/migrations before starting.",
    );
  }

  const seeds: Array<{
    eventType: string;
    graphKey: string;
    moduleQueue: string;
  }> = [
    {
      eventType: "syntra.jd.received",
      graphKey: "syntra.jd.workflow",
      moduleQueue: "module.syntra.jd",
    },
    {
      eventType: "syntra.resume.received",
      graphKey: "resume.intake",
      moduleQueue: "module.design.resume",
    },
    {
      eventType: "syntra.match.requested",
      graphKey: "syntra.match.workflow",
      moduleQueue: "module.syntra.match",
    },
    {
      eventType: "syntra.duplicate.review_required",
      graphKey: "duplicate.review",
      moduleQueue: "module.design.duplicate",
    },
    {
      eventType: "syntra.jd.parsed",
      graphKey: "syntra.continuous.match",
      moduleQueue: "module.syntra.match",
    },
    {
      eventType: "syntra.profile.prepared",
      graphKey: "syntra.duplicate.detect",
      moduleQueue: "module.design.duplicate",
    },
  ];

  for (const s of seeds) {
    await pool.query(
      `INSERT INTO platform.queues (key, description)
       VALUES ($1, 'Declared by a day-1 binding')
       ON CONFLICT (key) DO NOTHING`,
      [s.moduleQueue],
    );

    /**
     * Skipped, not invented, when the workflow is not there.
     *
     * `graph_id` is a foreign key, so a seed naming a workflow nobody has
     * authored cannot be written at all — and creating an empty graph to hold
     * it would hide the fault rather than fix it.
     */
    await pool.query(
      `INSERT INTO authoring.event_bindings (
         event_type, org_id, graph_id, queue_key, consuming_application,
         status, source
       )
       SELECT $1, NULL, g.id, $3,
              (SELECT q.application FROM platform.queues q WHERE q.key = $3),
              'active', 'seed'
         FROM authoring.graphs g
        WHERE g.graph_key = $2
          AND g.org_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM authoring.event_bindings b
             WHERE b.event_type = $1
               AND b.org_id IS NULL
               AND b.status = 'active'
          )
        LIMIT 1`,
      [s.eventType, s.graphKey, s.moduleQueue],
    );
  }

  for (const role of ["syntra_app", "syntra_relay"]) {
    try {
      await pool.query(
        `GRANT SELECT, INSERT, UPDATE ON authoring.event_bindings TO ${role}`,
      );
    } catch {
      /* role may not exist */
    }
  }
}
