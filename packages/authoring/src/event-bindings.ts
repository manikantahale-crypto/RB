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
  agent_id: string | null;
  version: number | null;
  status: string;
  source: string;
};

/**
 * Resolve active binding for ingress.
 * Prefers org-scoped row, else global (org_id IS NULL).
 * Returns null when nothing is active — caller must NOT fall back to code.
 */
export async function resolveActiveEventBinding(
  db: DbQueryable,
  eventType: string,
  organizationId?: string | null,
): Promise<EventBindingRow | null> {
  if (organizationId) {
    const org = await db.query<EventBindingRow & QueryResultRow>(
      `SELECT id, event_type, org_id::text, graph_key, module_queue,
              agent_id::text, version, status, source
         FROM graph_event_bindings
        WHERE event_type = $1
          AND org_id = $2::uuid
          AND status = 'active'
        LIMIT 1`,
      [eventType, organizationId],
    );
    if (org.rows[0]) return normalize(org.rows[0]);
  }

  const global = await db.query<EventBindingRow & QueryResultRow>(
    `SELECT id, event_type, org_id::text, graph_key, module_queue,
            agent_id::text, version, status, source
       FROM graph_event_bindings
      WHERE event_type = $1
        AND org_id IS NULL
        AND status = 'active'
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
    agent_id: row.agent_id == null ? null : String(row.agent_id),
    version: row.version == null ? null : Number(row.version),
    status: String(row.status),
    source: String(row.source),
  };
}

export class EventAlreadyBoundError extends Error {
  readonly code = "EVENT_ALREADY_BOUND";
  constructor(
    public readonly eventType: string,
    public readonly existingAgentId: string | null,
    public readonly existingGraphKey: string,
  ) {
    super(
      `Event "${eventType}" is already bound to graph "${existingGraphKey}"` +
        (existingAgentId ? ` (agent ${existingAgentId})` : "") +
        `. Retire or rebind that agent before activating another.`,
    );
    this.name = "EventAlreadyBoundError";
  }
}

/**
 * Activate authoring binding: retire other active rows for this event+scope,
 * insert/update this agent's binding. Same agent may replace its own binding.
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
    agentId: string;
    version: number;
  },
): Promise<EventBindingRow> {
  const trigger = getTriggerEvent(args.eventType);
  if (!trigger) {
    throw new Error(`Unknown trigger event_type: ${args.eventType}`);
  }
  const moduleQueue = args.moduleQueue ?? trigger.moduleQueue;
  const orgId = args.orgId;

  const existing = await resolveActiveEventBinding(client, args.eventType, orgId);
  if (
    existing &&
    existing.agent_id &&
    existing.agent_id !== args.agentId &&
    existing.source === "authoring"
  ) {
    throw new EventAlreadyBoundError(
      args.eventType,
      existing.agent_id,
      existing.graph_key,
    );
  }

  // Retire all active for this event+scope (including seed) before insert.
  if (orgId === null) {
    await client.query(
      `UPDATE graph_event_bindings
          SET status = 'retired', updated_at = now()
        WHERE event_type = $1
          AND org_id IS NULL
          AND status = 'active'`,
      [args.eventType],
    );
  } else {
    await client.query(
      `UPDATE graph_event_bindings
          SET status = 'retired', updated_at = now()
        WHERE event_type = $1
          AND org_id = $2::uuid
          AND status = 'active'`,
      [args.eventType, orgId],
    );
  }

  const inserted = await client.query<EventBindingRow & QueryResultRow>(
    `INSERT INTO graph_event_bindings (
       event_type, org_id, graph_key, module_queue, agent_id, version, status, source
     ) VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6, 'active', 'authoring')
     RETURNING id, event_type, org_id::text, graph_key, module_queue,
               agent_id::text, version, status, source`,
    [
      args.eventType,
      orgId,
      args.graphKey,
      moduleQueue,
      args.agentId,
      args.version,
    ],
  );

  return normalize(inserted.rows[0]!);
}

/** Ensure table + seed day-1 bindings (local boot without Flyway). */
export async function ensureEventBindingsSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS graph_event_bindings (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type    text NOT NULL,
      org_id        uuid,
      graph_key     text NOT NULL,
      module_queue  text NOT NULL,
      agent_id      uuid,
      version       int,
      status        text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'retired')),
      source        text NOT NULL DEFAULT 'authoring'
                    CHECK (source IN ('seed', 'authoring')),
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS graph_event_bindings_one_active
      ON graph_event_bindings (event_type, COALESCE(org_id::text, '~global~'))
      WHERE status = 'active'
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS graph_event_bindings_lookup
      ON graph_event_bindings (event_type, status)
  `);

  const seeds: Array<{
    eventType: string;
    graphKey: string;
    moduleQueue: string;
    agentId: string;
  }> = [
    {
      eventType: "syntra.jd.received",
      graphKey: "syntra.jd.workflow",
      moduleQueue: "module.syntra.jd",
      agentId: "01900000-0000-7000-8000-000000000501",
    },
    {
      eventType: "syntra.resume.received",
      graphKey: "resume.intake",
      moduleQueue: "module.design.resume",
      agentId: "01900000-0000-7000-8000-000000000502",
    },
    {
      eventType: "syntra.match.requested",
      graphKey: "syntra.match.workflow",
      moduleQueue: "module.syntra.match",
      agentId: "01900000-0000-7000-8000-000000000501",
    },
    {
      eventType: "syntra.duplicate.review_required",
      graphKey: "duplicate.review",
      moduleQueue: "module.design.duplicate",
      agentId: "01900000-0000-7000-8000-000000000502",
    },
    {
      eventType: "syntra.jd.parsed",
      graphKey: "syntra.continuous.match",
      moduleQueue: "module.syntra.match",
      agentId: "01900000-0000-7000-8000-000000000501",
    },
    {
      eventType: "syntra.profile.prepared",
      graphKey: "syntra.duplicate.detect",
      moduleQueue: "module.design.duplicate",
      agentId: "01900000-0000-7000-8000-000000000502",
    },
  ];

  for (const s of seeds) {
    await pool.query(
      `INSERT INTO graph_event_bindings (
         event_type, org_id, graph_key, module_queue, agent_id, version, status, source
       )
       SELECT $1, NULL, $2, $3, $4::uuid, 1, 'active', 'seed'
       WHERE NOT EXISTS (
         SELECT 1 FROM graph_event_bindings b
          WHERE b.event_type = $1
            AND b.org_id IS NULL
            AND b.status = 'active'
       )`,
      [s.eventType, s.graphKey, s.moduleQueue, s.agentId],
    );
  }

  for (const role of ["syntra_app", "syntra_relay"]) {
    try {
      await pool.query(
        `GRANT SELECT, INSERT, UPDATE ON graph_event_bindings TO ${role}`,
      );
    } catch {
      /* role may not exist */
    }
  }
}
