// Outbox relay worker.
//
// The ONLY publisher into pg-boss. Reads unpublished rows from event_outbox,
// inserts the pg-boss job on the **same Postgres transaction client** as the
// published_at update (pg-boss `db` option), then COMMITs — so enqueue + mark
// published succeed or fail together (true transactional outbox on one DB).

import { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { env } from "../env.js";
import type { EventEnvelope, EventType } from "@tekisho/domain";
import type { DbQueryable } from "@tekisho/authoring/src/event-bindings.js";
import {
  planForEvent,
  INGRESS_QUEUE,
  DISPATCH_QUEUE,
  MODULE_SEND_OPTIONS,
} from "@tekisho/orchestrator/src/routing/table.js";
import { decideRelayTargets } from "@tekisho/orchestrator/src/routing/decide-route.js";

export { DISPATCH_QUEUE };
export const DISPATCH_DLQ = "orchestration.dispatch.dlq";

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 1000;

const RETRY_LIMIT = 5;
const RETRY_DELAY_SECONDS = 5;

export interface OutboxRow {
  id: string; // bigint returns as string from pg
  event_id: string;
  event_type: EventType;
  schema_version: string;
  organization_id: string;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  causation_id: string | null;
  producer: string;
  payload_ref: Record<string, unknown>;
  occurred_at: Date;
}

/** pg-boss IDatabase adapter over a pg Client already inside BEGIN. */
export function pgClientAsBossDb(client: {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: unknown[] }>;
}) {
  return {
    executeSql: async (text: string, values?: unknown[]) => {
      const result = await client.query(text, values);
      return { rows: result.rows };
    },
  };
}

export function toEnvelope(row: OutboxRow): EventEnvelope {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    schema_version: row.schema_version,
    occurred_at: row.occurred_at.toISOString(),
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    organization_id: row.organization_id,
    aggregate: { type: row.aggregate_type, id: row.aggregate_id },
    payload_ref: row.payload_ref,
    producer: row.producer,
  };
}

function isPermissionish(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /permission denied|insufficient_privilege|must be owner|does not exist/i.test(
      message,
    )
  );
}

export async function relayOnce(
  pool: Pool,
  boss: PgBoss,
  resolvePin?: StartOutboxRelayOptions["resolvePin"],
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<OutboxRow>(
      `SELECT id, event_id, event_type, schema_version, organization_id,
              aggregate_type, aggregate_id, correlation_id, causation_id,
              producer, payload_ref, occurred_at
         FROM orch.event_outbox
        WHERE published_at IS NULL
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [BATCH_SIZE],
    );

    if (rows.length === 0) {
      await client.query("COMMIT");
      return 0;
    }

    const txDb = pgClientAsBossDb(client);
    const publishedIds: string[] = [];

    /**
     * WHICH EVENTS SOMEBODY HAS BOUND A WORKFLOW TO.
     *
     * This relay is the FIRST of the two places `planForEvent` used to decide
     * everything, and it is the one that actually matters: an event it sends to
     * DISPATCH never reaches the ingress router at all. Fixing the router alone
     * changed nothing for the six bindings whose events the hardcoded map calls
     * terminal or fail — they were never routed there in the first place.
     *
     * So a bound event now goes to the router as well, whatever the map says.
     *
     * ADDITIVE, NOT A SWAP. Dispatch keeps its control-plane duties, and they
     * are not optional: `resume` unparks a waiting human gate, `fail` records
     * the run for replay. A bound `fail` event now does BOTH — the failure is
     * recorded and the retry workflow runs, which is exactly the intent.
     *
     * One query per batch rather than one per event: there are twenty bindings
     * and a hundred rows in a batch, and this sits in the hot path.
     */
    const boundEvents = await client
      .query<{ event_type: string }>(
        `SELECT DISTINCT event_type FROM authoring.event_bindings WHERE status = 'active'`,
      )
      .then((r) => new Set(r.rows.map((x) => x.event_type)))
      .catch(() => new Set<string>());

    for (const row of rows) {
      const envelope = toEnvelope(row);
      const plan = planForEvent(row.event_type);
      const sendOpts = {
        ...MODULE_SEND_OPTIONS,
        singletonKey: row.event_id,
        db: txDb,
      };

      const targets = decideRelayTargets({
        plan,
        bound: boundEvents.has(row.event_type),
      });

      if (targets.ingress) {
        console.log(
          `[Orch] ── RELAY  ${row.event_type}  id=${row.event_id}  producer=${row.producer}  corr=${row.correlation_id}  → ${INGRESS_QUEUE}  next=router` +
            (plan.kind !== "graph" ? `  (bound; map says ${plan.kind})` : ""),
        );
        try {
          await boss.send(INGRESS_QUEUE, envelope, sendOpts);
        } catch (err) {
          // Separate relay role may lack pgboss write — fall back off-TX send.
          if (!isPermissionish(err)) throw err;
          await boss.send(INGRESS_QUEUE, envelope, {
            ...MODULE_SEND_OPTIONS,
            singletonKey: row.event_id,
          });
        }
      }

      if (targets.dispatch) {
        const stamped = envelope as EventEnvelope & {
          __graphKey?: string;
          __graphVersion?: number;
        };
        // Skip pin lookup for terminal events; fail-open so pooler timeouts
        // never roll back the batch (would strand siblings like syntra.jd.normalized).
        if (resolvePin && plan.kind !== "terminal") {
          try {
            const pin = await resolvePin(
              row.event_type,
              row.organization_id,
              client,
            );
            if (pin) {
              stamped.__graphKey = pin.graphKey;
              stamped.__graphVersion = pin.graphVersion;
            }
          } catch (err) {
            console.warn(
              `[OutboxRelay] resolvePin fail-open for ${row.event_type}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
        try {
          await boss.send(DISPATCH_QUEUE, stamped, sendOpts);
        } catch (err) {
          if (!isPermissionish(err)) throw err;
          await boss.send(DISPATCH_QUEUE, stamped, {
            ...MODULE_SEND_OPTIONS,
            singletonKey: row.event_id,
          });
        }
        console.log(
          `[Orch] ── RELAY  ${row.event_type}  id=${row.event_id}  → ${DISPATCH_QUEUE}  (terminal/control)`,
        );
      }
      publishedIds.push(row.id);
    }

    await client.query(
      `UPDATE orch.event_outbox
          SET published_at = now()
        WHERE id = ANY($1::bigint[])`,
      [publishedIds],
    );

    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type StartOutboxRelayOptions = {
  /** Shared dispatcher PgBoss — avoids a second session-mode connection pool. */
  boss: PgBoss;
  /**
   * Shared migrator pool (compiler / checkpointer / outbox writes).
   * Preferred for transactional send (same role can write pgboss + event_outbox).
   */
  pool?: Pool;
  resolvePin?: (
    eventType: string,
    organizationId: string,
    /** Must use this client when called inside relayOnce (pool.max is 1). */
    db: DbQueryable,
  ) => Promise<{ graphKey: string; graphVersion: number } | null>;
};

function isPoolerExhausted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("EMAXCONNSESSION") || message.includes("max clients");
}

/** Returns an error message if the DB role cannot relay; null if OK. */
async function checkOutboxRelayPrivileges(pool: Pool): Promise<string | null> {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isPoolerExhausted(error)) {
      return (
        `session pooler exhausted (EMAXCONNSESSION) during privilege check — ` +
        `relay disabled. Stop other workers / wait for idle connections, then restart.`
      );
    }
    throw error;
  }
  try {
    const { rows } = await client.query<{
      current_user: string;
      can_update: boolean;
    }>(`
      SELECT current_user,
             -- Schema-qualified deliberately. Unqualified, this resolves by
             -- search_path to the compatibility VIEW public.event_outbox, and
             -- a privilege on the view says nothing about the table the relay
             -- actually locks rows in.
             has_table_privilege(current_user, 'orch.event_outbox', 'update') AS can_update
    `);
    const { current_user: dbUser, can_update: canUpdate } = rows[0]!;
    if (!canUpdate) {
      return (
        `Outbox relay DB role "${dbUser}" lacks UPDATE on orch.event_outbox ` +
        `(SELECT ... FOR UPDATE + mark published_at both need it). ` +
        `Prefer shared migrator pool (leave DATABASE_RELAY_URL empty) after ` +
        `packages/db/scripts/grant-orch-runtime.sql, or set DATABASE_RELAY_URL to syntra_relay.`
      );
    }

    await client.query("BEGIN");
    try {
      await client.query(`
        SELECT id FROM orch.event_outbox
         WHERE published_at IS NULL
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      `);
      await client.query("COMMIT");
      return null;
    } catch (error) {
      await client.query("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      return (
        `Outbox relay cannot lock orch.event_outbox rows as "${dbUser}": ${message}. ` +
        `Under FORCE RLS the role also needs an UPDATE policy ` +
        `(see packages/db/scripts/grant-orch-runtime.sql).`
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Starts the outbox poll loop. Caller owns PgBoss lifecycle (start/stop).
 *
 * Prefers the shared migrator `pool` (same role as pg-boss) so job insert +
 * published_at commit atomically. DATABASE_RELAY_URL is used only when no
 * shared pool is provided.
 */
export async function startOutboxRelay(
  options: StartOutboxRelayOptions,
): Promise<() => Promise<void>> {
  const { boss, resolvePin } = options;
  const relayUrl = env.DATABASE_RELAY_URL?.trim() ?? "";
  const usingRelayUrl = relayUrl.length > 0 && !options.pool;

  let pool: Pool;
  let ownsPool = false;
  if (options.pool) {
    // Same connection role as pg-boss → transactional send via { db }.
    pool = options.pool;
    if (relayUrl.length > 0) {
      console.log(
        "[OutboxRelay] shared migrator pool preferred for transactional send (DATABASE_RELAY_URL ignored while pool is passed)",
      );
    }
  } else if (relayUrl.length > 0) {
    pool = new Pool({
      connectionString: relayUrl,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    ownsPool = true;
  } else {
    pool = new Pool({
      connectionString: env.DATABASE_MIGRATOR_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    ownsPool = true;
  }
  if (ownsPool) {
    pool.on("error", (error: Error) => {
      console.error("[OutboxRelay] pg pool error:", error.message);
    });
  }

  await boss.createQueue(DISPATCH_DLQ);
  await boss.createQueue(DISPATCH_QUEUE, {
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    deadLetter: DISPATCH_DLQ,
  });
  await boss.createQueue(INGRESS_QUEUE);

  const privilegeError = await checkOutboxRelayPrivileges(pool);
  if (privilegeError) {
    console.error(`[OutboxRelay] DISABLED — ${privilegeError}`);
    return async () => {
      if (ownsPool) await pool.end();
      console.log("Outbox relay stopped (was disabled)");
    };
  }

  let stopped = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        let processed = 0;
        do {
          processed = await relayOnce(pool, boss, resolvePin);
          if (processed > 0) {
            console.log(`[OutboxRelay] published ${processed} event(s)`);
          }
        } while (processed === BATCH_SIZE && !stopped);
      } catch (error) {
        console.error("outbox relay tick failed:", error);
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  };

  void loop();
  if (options.pool) {
    console.log(
      `Outbox relay started → ${INGRESS_QUEUE} / ${DISPATCH_QUEUE} (shared pool, transactional send)`,
    );
  } else if (usingRelayUrl) {
    console.log(
      `Outbox relay started → ${DISPATCH_QUEUE} (DATABASE_RELAY_URL — prefer shared migrator pool for atomic send)`,
    );
  } else {
    console.log(
      `Outbox relay started → ${DISPATCH_QUEUE} (migrator pool, transactional send)`,
    );
  }

  return async () => {
    stopped = true;
    if (ownsPool) await pool.end();
    console.log("Outbox relay stopped");
  };
}
