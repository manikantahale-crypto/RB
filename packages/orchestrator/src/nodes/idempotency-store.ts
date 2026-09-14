/**
 * The claim table, in SQL.
 *
 * Kept apart from `idempotency.ts` so the decision — which nodes, which key,
 * what to do on a hit — stays readable and testable without a database, and
 * this file holds only the part that talks to one.
 */
import type { DedupeClaim, DedupeStore } from './idempotency.js';

/** Minimal shape of a pg client, so this needs no dependency on `pg`. */
export type Queryable = {
  query: (
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

/**
 * How long a claim may sit in `running` before another run may take it.
 *
 * A worker that is killed mid-node leaves its claim behind. Without a takeover
 * window that key is dead for the rest of the flow and the step never runs —
 * the silent-omission failure, which is worse than the duplicate this file
 * prevents.
 *
 * Fifteen minutes is comfortably longer than any node here takes and far
 * shorter than a flow's life, so a crashed claim is recovered within one
 * retry cycle rather than at the end of the day.
 */
const STALE_CLAIM = '15 minutes';

export function pgDedupeStore(db: Queryable): DedupeStore {
  return {
    async claim({ orgId, nodeKey, idempotencyKey, correlationId, nodeId }) {
      /**
       * The claim IS the insert. Two runs racing for the same key both issue
       * this; exactly one gets a row back, and that one owns the work.
       * Checking first and inserting after would leave a window where both
       * read "nobody has it".
       *
       * The DO UPDATE clause is the stale takeover, and its WHERE is what
       * keeps it honest: only a `running` row, only one older than the window.
       * A `done` row is never taken over.
       */
      const claimed = await db.query(
        `INSERT INTO orch.node_idempotency
           (org_id, node_key, idempotency_key, correlation_id, node_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, node_key, idempotency_key, correlation_id) DO UPDATE
            SET claimed_at = now(), node_id = EXCLUDED.node_id
          WHERE orch.node_idempotency.status = 'running'
            AND orch.node_idempotency.claimed_at < now() - interval '${STALE_CLAIM}'
         RETURNING node_id`,
        [orgId, nodeKey, idempotencyKey, correlationId, nodeId],
      );
      if (claimed.rows.length > 0) return { kind: 'claimed' };

      // Somebody holds it. Which it is decides what the log says, not what
      // happens — either way this run does not repeat the work.
      const held = await db.query(
        `SELECT status, node_id FROM orch.node_idempotency
          WHERE org_id = $1 AND node_key = $2
            AND idempotency_key = $3 AND correlation_id = $4`,
        [orgId, nodeKey, idempotencyKey, correlationId],
      );
      const row = held.rows[0];
      /**
       * The row vanished between the two statements — swept, or released by a
       * failure. Nothing holds the key now, so running is the safe answer:
       * this file fails open, always.
       */
      if (!row) return { kind: 'claimed' };

      const byNodeId = typeof row.node_id === 'string' ? row.node_id : null;
      return row.status === 'done'
        ? ({ kind: 'already_done', byNodeId } satisfies DedupeClaim)
        : ({ kind: 'in_flight', byNodeId } satisfies DedupeClaim);
    },

    async complete({ orgId, nodeKey, idempotencyKey, correlationId }) {
      await db.query(
        `UPDATE orch.node_idempotency
            SET status = 'done', completed_at = now()
          WHERE org_id = $1 AND node_key = $2
            AND idempotency_key = $3 AND correlation_id = $4`,
        [orgId, nodeKey, idempotencyKey, correlationId],
      );
    },

    async release({ orgId, nodeKey, idempotencyKey, correlationId }) {
      /**
       * Deleted, not marked failed. A failure means the work did not happen,
       * so the next attempt must be able to claim the key cleanly — and a
       * `failed` status would be a third state every reader has to know about
       * to reach the same conclusion.
       *
       * Guarded on `running` so a late failure cannot delete a claim that has
       * since been completed by someone else.
       */
      await db.query(
        `DELETE FROM orch.node_idempotency
          WHERE org_id = $1 AND node_key = $2
            AND idempotency_key = $3 AND correlation_id = $4
            AND status = 'running'`,
        [orgId, nodeKey, idempotencyKey, correlationId],
      );
    },
  };
}
