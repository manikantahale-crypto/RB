/**
 * Design D3 — pin graph version for the life of a pg-boss job.
 * Prefer payload stamps from enqueue (relay); fall back to durable pin rows
 * when Syntra publishes without a pin (direct queues).
 */

import type { DbQueryable } from "@tekisho/orchestrator/src/db/with-org-connection.js";

export type GraphPin = {
  graphKey: string;
  graphVersion: number;
};

const PIN_TABLE = "orchestration_job_pins";

export async function ensureJobPinTable(db: DbQueryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${PIN_TABLE} (
      boss_job_id   text PRIMARY KEY,
      graph_key     text NOT NULL,
      graph_version int  NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Resolve pin for a job: payload → existing pin row → resolve+insert.
 */
export async function resolveDurablePin(
  db: DbQueryable,
  args: {
    bossJobId: string;
    graphKey: string;
    organizationId: string;
    payloadPin?: { graphKey?: string; graphVersion?: number };
    resolveActiveVersion: (graphKey: string, orgId: string) => Promise<number>;
  },
): Promise<GraphPin> {
  const fromPayload = args.payloadPin?.graphVersion;
  const payloadKey = args.payloadPin?.graphKey ?? args.graphKey;

  if (typeof fromPayload === "number" && Number.isFinite(fromPayload)) {
    await db.query(
      `INSERT INTO ${PIN_TABLE} (boss_job_id, graph_key, graph_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (boss_job_id) DO NOTHING`,
      [args.bossJobId, payloadKey, fromPayload],
    );
    return { graphKey: payloadKey, graphVersion: fromPayload };
  }

  const existing = await db.query<{ graph_key: string; graph_version: number }>(
    `SELECT graph_key, graph_version FROM ${PIN_TABLE} WHERE boss_job_id = $1`,
    [args.bossJobId],
  );
  if (existing.rows[0]) {
    return {
      graphKey: existing.rows[0].graph_key,
      graphVersion: existing.rows[0].graph_version,
    };
  }

  const graphVersion = await args.resolveActiveVersion(
    args.graphKey,
    args.organizationId,
  );

  await db.query(
    `INSERT INTO ${PIN_TABLE} (boss_job_id, graph_key, graph_version)
     VALUES ($1, $2, $3)
     ON CONFLICT (boss_job_id) DO NOTHING`,
    [args.bossJobId, args.graphKey, graphVersion],
  );

  const again = await db.query<{ graph_key: string; graph_version: number }>(
    `SELECT graph_key, graph_version FROM ${PIN_TABLE} WHERE boss_job_id = $1`,
    [args.bossJobId],
  );
  const row = again.rows[0]!;
  return { graphKey: row.graph_key, graphVersion: row.graph_version };
}
