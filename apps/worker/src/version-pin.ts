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

/**
 * Check the pin table is there. It is built by packages/db/migrations.
 *
 * This table exists only because a run could not name the version it was
 * running. `orch.runs.graph_version_id` (V20260909.12) is that link done
 * properly, and this table is superseded — but it cannot simply be dropped
 * while this code still reads it, and it keys on boss_job_id so its 9,962 rows
 * cannot be joined to a run to migrate them. It goes when the worker stamps
 * the version onto the run instead.
 */
export async function ensureJobPinTable(db: DbQueryable): Promise<void> {
  const { rows } = await db.query<{ present: boolean }>(
    `SELECT to_regclass('public.${PIN_TABLE}') IS NOT NULL AS present`,
  );
  if (!rows[0]?.present) {
    throw new Error(
      `[worker] ${PIN_TABLE} is missing. Apply packages/db/migrations before ` +
        `starting the worker.`,
    );
  }
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
